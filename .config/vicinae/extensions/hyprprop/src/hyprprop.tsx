import {
  Action,
  ActionPanel,
  Clipboard,
  closeMainWindow,
  Color,
  Detail,
  Icon,
  showToast,
  Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import type { HyprpropWindowInfo } from "./types";

const execAsync = promisify(exec);

function extractMatchClauses(rule: string): Array<{ key: string; value: string }> {
  const clauses: Array<{ key: string; value: string }> = [];
  const matchPattern = /match:(class|initial_class|title|initial_title)\s+([^,]+?)(?=,|$)/g;
  let match = matchPattern.exec(rule);
  while (match !== null) {
    clauses.push({ key: match[1], value: match[2].trim() });
    match = matchPattern.exec(rule);
  }
  return clauses;
}

function matchesWindow(info: HyprpropWindowInfo, rule: string): boolean {
  const clauses = extractMatchClauses(rule);
  if (clauses.length === 0) {
    return false;
  }
  return clauses.every((clause) => {
    const target = (() => {
      switch (clause.key) {
        case "class":
          return info.class;
        case "initial_class":
          return info.initialClass;
        case "title":
          return info.title;
        case "initial_title":
          return info.initialTitle;
        default:
          return "";
      }
    })();

    if (!target) {
      return false;
    }

    try {
      const regex = new RegExp(clause.value);
      return regex.test(target);
    } catch {
      return target.includes(clause.value);
    }
  });
}

async function loadRulesMatches(info: HyprpropWindowInfo): Promise<string[]> {
  const homeDir = os.homedir();
  const files = [
    { label: "rules.conf", path: `${homeDir}/.config/hypr/rules.conf` },
    { label: "generated-rules.conf", path: `${homeDir}/.config/hypr/generated-rules.conf` },
  ];
  const matches: string[] = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file.path, "utf8");
      const lines = raw.split(/\r?\n/);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        if (!trimmed.startsWith("windowrule")) {
          continue;
        }
        if (matchesWindow(info, trimmed)) {
          matches.push(`${file.label}:${index + 1} ${trimmed}`);
        }
      }
    } catch (error) {
      console.warn(`Failed to read ${file.label}`, error);
    }
  }

  return matches;
}

function formatWindowInfo(info: HyprpropWindowInfo, rules: string[]): string {
  const sections: string[] = [];

  // Title
  sections.push(`# ${info.title}`);
  sections.push("");
  sections.push(`**${info.class}** • PID ${info.pid}`);
  sections.push("");

  // Window Identity
  sections.push("## Window Identity");
  sections.push("");
  sections.push("| Property | Value |");
  sections.push("|----------|-------|");
  sections.push(`| Class | \`${info.class}\` |`);
  sections.push(`| Initial Class | \`${info.initialClass}\` |`);
  sections.push(`| Address | \`${info.address}\` |`);
  sections.push(`| Title | ${info.title} |`);
  sections.push(`| Initial Title | ${info.initialTitle} |`);
  sections.push("");

  // Layout
  sections.push("## Layout");
  sections.push("");
  sections.push("| Property | Value |");
  sections.push("|----------|-------|");
  sections.push(`| Position | \`(${info.at[0]}, ${info.at[1]})\` |`);
  sections.push(`| Size | \`${info.size[0]} × ${info.size[1]}\` px |`);
  sections.push(`| Workspace | ${info.workspace.name} (ID: ${info.workspace.id}) |`);
  sections.push(`| Monitor | ${info.monitor} |`);
  sections.push("");

  // State
  sections.push("## State");
  sections.push("");
  sections.push("| Property | Value |");
  sections.push("|----------|-------|");
  sections.push(`| Floating | ${info.floating ? "✓ Yes" : "✗ No"} |`);
  sections.push(`| Fullscreen | ${info.fullscreen ? (info.fakeFullscreen ? "⚠ Fake" : "✓ Yes") : "✗ No"} |`);
  sections.push(`| Pinned | ${info.pinned ? "✓ Yes" : "✗ No"} |`);
  sections.push(`| Hidden | ${info.hidden ? "✓ Yes" : "✗ No"} |`);
  sections.push(`| Mapped | ${info.mapped ? "✓ Yes" : "✗ No"} |`);
  sections.push("");

  // Technical
  sections.push("## Technical");
  sections.push("");
  sections.push("| Property | Value |");
  sections.push("|----------|-------|");
  sections.push(`| PID | \`${info.pid}\` |`);
  sections.push(`| XWayland | ${info.xwayland ? "✓ Yes" : "✗ No"} |`);
  sections.push(`| Focus History ID | \`${info.focusHistoryID}\` |`);
  if (info.swallowing) {
    sections.push(`| Swallowing | \`${info.swallowing}\` |`);
  }
  if (info.grouped && info.grouped.length > 0) {
    sections.push(`| Grouped | \`${JSON.stringify(info.grouped)}\` |`);
  }
  sections.push("");

  // Rules
  sections.push("## Matching Rules");
  sections.push("");
  if (rules.length === 0) {
    sections.push("No matching rules found in `~/.config/hypr/rules.conf` or `~/.config/hypr/generated-rules.conf`.");
  } else {
    sections.push("```text");
    sections.push(...rules);
    sections.push("```");
  }
  sections.push("");

  return sections.join("\n");
}

export default function Command() {
  const [windowInfo, setWindowInfo] = useState<HyprpropWindowInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [matchingRules, setMatchingRules] = useState<string[]>([]);

  const fetchWindowInfo = useCallback(async (): Promise<HyprpropWindowInfo | null> => {
    try {
      // Check if hyprprop is available
      try {
        await execAsync("which hyprprop");
      } catch {
        await showToast({
          style: Toast.Style.Failure,
          title: "hyprprop not found",
          message: "Please install hyprprop to use this extension",
        });
        return null;
      }

      // Run hyprprop with --raw flag to get JSON output
      const { stdout, stderr } = await execAsync("hyprprop --raw");

      if (stderr) {
        console.error("hyprprop stderr:", stderr);
      }

      if (!stdout || stdout.trim() === "") {
        await showToast({
          style: Toast.Style.Failure,
          title: "No window selected",
          message: "Please select a window",
        });
        return null;
      }

      const data: HyprpropWindowInfo = JSON.parse(stdout);
      return data;
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to get window info",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }, []);

  const loadWindowInfo = useCallback(async () => {
    setIsLoading(true);
    const info = await fetchWindowInfo();
    setWindowInfo(info);
    if (info) {
      const rules = await loadRulesMatches(info);
      setMatchingRules(rules);
    } else {
      setMatchingRules([]);
    }
    setIsLoading(false);
  }, [fetchWindowInfo]);

  useEffect(() => {
    loadWindowInfo();
  }, [loadWindowInfo]);

  if (isLoading) {
    return <Detail markdown={`# Select a Window

**Hyprprop** is waiting for you to select a window.

Click on any window to view its properties...`} />;
  }

  if (!windowInfo) {
    return (
      <Detail
        markdown={`# No Window Information

Failed to retrieve window information. Please try again.

## Possible Reasons

- No window was selected
- Hyprprop command failed
- Window closed before info could be retrieved

Press **⌘R** to retry.`}
        actions={
          <ActionPanel>
            <Action
              title="Retry"
              icon={Icon.ArrowClockwise}
              onAction={loadWindowInfo}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          </ActionPanel>
        }
      />
    );
  }

  const markdown = formatWindowInfo(windowInfo, matchingRules);

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Application"
            text={windowInfo.class}
            icon={Icon.AppWindow}
          />
          <Detail.Metadata.Label
            title="PID"
            text={String(windowInfo.pid)}
            icon={Icon.Code}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Workspace"
            text={`${windowInfo.workspace.name} (${windowInfo.workspace.id})`}
            icon={Icon.Desktop}
          />
          <Detail.Metadata.Label
            title="Monitor"
            text={String(windowInfo.monitor)}
            icon={Icon.Monitor}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Rules"
            text={String(matchingRules.length)}
            icon={Icon.List}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Position"
            text={`${windowInfo.at[0]}, ${windowInfo.at[1]}`}
            icon={Icon.Pin}
          />
          <Detail.Metadata.Label
            title="Size"
            text={`${windowInfo.size[0]} × ${windowInfo.size[1]}`}
            icon={Icon.Box}
          />
          <Detail.Metadata.Separator />
          {(windowInfo.floating || windowInfo.fullscreen || windowInfo.pinned || windowInfo.xwayland || windowInfo.hidden) ? (
            <Detail.Metadata.TagList title="State">
              {windowInfo.floating ? (
                <Detail.Metadata.TagList.Item text="Floating" color={Color.Green} />
              ) : null}
              {windowInfo.fullscreen ? (
                <Detail.Metadata.TagList.Item 
                  text={windowInfo.fakeFullscreen ? "Fake Fullscreen" : "Fullscreen"} 
                  color={windowInfo.fakeFullscreen ? Color.Orange : Color.Blue} 
                />
              ) : null}
              {windowInfo.pinned ? (
                <Detail.Metadata.TagList.Item text="Pinned" color={Color.Purple} />
              ) : null}
              {windowInfo.xwayland ? (
                <Detail.Metadata.TagList.Item text="XWayland" color={Color.Yellow} />
              ) : null}
              {windowInfo.hidden ? (
                <Detail.Metadata.TagList.Item text="Hidden" color={Color.Red} />
              ) : null}
            </Detail.Metadata.TagList>
          ) : null}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Retry Selection"
            icon={Icon.ArrowClockwise}
            onAction={loadWindowInfo}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
          <ActionPanel.Section>
            <Action
              title="Copy Window Class"
              icon={Icon.Clipboard}
              onAction={async () => {
                await Clipboard.copy(windowInfo.class);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Copied Window Class",
                  message: windowInfo.class,
                });
              }}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            <Action
              title="Copy Window Address"
              icon={Icon.Clipboard}
              onAction={async () => {
                await Clipboard.copy(windowInfo.address);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Copied Window Address",
                  message: windowInfo.address,
                });
              }}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy All Info"
              content={JSON.stringify(windowInfo, null, 2)}
              shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Close"
              icon={Icon.XMarkCircle}
              onAction={async () => {
                await closeMainWindow();
              }}
              shortcut={{ modifiers: ["cmd"], key: "w" }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
