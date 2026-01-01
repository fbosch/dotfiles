import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  Icon,
  List,
  showToast,
  Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HyprpropWindowInfo, WindowRuleProfile, RuleSelector } from "./types";

const execAsync = promisify(exec);

// Common window rule profiles based on existing rules.conf
const RULE_PROFILES: WindowRuleProfile[] = [
  {
    id: "floating-small",
    name: "Floating (Small)",
    description: "Float window with small size (360x620)",
    icon: Icon.AppWindowSidebarRight,
    rules: ["float on", "size 360 620"],
  },
  {
    id: "floating-medium",
    name: "Floating (Medium)",
    description: "Float window with medium size (750x900)",
    icon: Icon.AppWindowSidebarRight,
    rules: ["float on", "size 750 900"],
  },
  {
    id: "floating-large",
    name: "Floating (Large)",
    description: "Float window with large size (900x900)",
    icon: Icon.AppWindowSidebarRight,
    rules: ["float on", "size 900 900"],
  },
  {
    id: "floating-centered",
    name: "Floating (Centered)",
    description: "Float window and center it",
    icon: Icon.Center,
    rules: ["float on", "center on"],
  },
  {
    id: "floating-pinned",
    name: "Floating + Pinned",
    description: "Float and pin to all workspaces",
    icon: Icon.Pin,
    rules: ["float on", "pin on"],
  },
  {
    id: "floating-pinned-corner",
    name: "Floating + Pinned (Corner)",
    description: "Float, pin, and position in bottom-right corner",
    icon: Icon.Pin,
    rules: ["float on", "pin on", "move onscreen 100% 100%"],
  },
  {
    id: "fullscreen",
    name: "Fullscreen",
    description: "Force fullscreen mode",
    icon: Icon.Maximize,
    rules: ["fullscreen on"],
  },
  {
    id: "no-animations",
    name: "No Animations",
    description: "Disable animations (useful for games)",
    icon: Icon.XMarkCircle,
    rules: ["no_anim on"],
  },
  {
    id: "no-bar",
    name: "No Title Bar",
    description: "Hide hyprbars title bar",
    icon: Icon.Minus,
    rules: ["hyprbars:no_bar 1"],
  },
  {
    id: "no-bar-float",
    name: "No Bar + Float",
    description: "Hide title bar and float window",
    icon: Icon.AppWindowSidebarRight,
    rules: ["hyprbars:no_bar 1", "float on"],
  },
  {
    id: "gaming",
    name: "Gaming Profile",
    description: "No animations, no bar, no borders, fullscreen (like Steam games)",
    icon: Icon.GameController,
    rules: [
      "no_anim on",
      "hyprbars:no_bar 1",
      "border_size 0",
      "rounding 0",
      "no_shadow on",
      "opacity 1.0 override 1.0 override",
      "fullscreen on",
    ],
  },
  {
    id: "utility",
    name: "Utility Window",
    description: "Float, pin, no animations, positioned at corner (like system tools)",
    icon: Icon.Hammer,
    rules: ["float on", "pin on", "no_anim on", "move onscreen 100% 100%"],
  },
  {
    id: "clean-fullscreen",
    name: "Clean Fullscreen",
    description: "Fullscreen with no decorations (like remote desktop)",
    icon: Icon.Monitor,
    rules: ["hyprbars:no_bar 1", "fullscreen on"],
  },
  {
    id: "picture-in-picture",
    name: "Picture-in-Picture",
    description: "Float, pin, with slide animation (like browser PiP)",
    icon: Icon.Video,
    rules: ["float on", "pin on", "hyprbars:no_bar 1", "animation slide right"],
  },
  {
    id: "dialog",
    name: "Dialog Window",
    description: "Float, pin, no animations, no bar (like system dialogs)",
    icon: Icon.Message,
    rules: ["float on", "pin on", "no_anim on", "hyprbars:no_bar 1"],
  },
  {
    id: "file-manager",
    name: "File Manager",
    description: "Float with no animations (like Nemo)",
    icon: Icon.Finder,
    rules: ["float on", "no_anim on"],
  },
  {
    id: "borderless",
    name: "Borderless Window",
    description: "Remove borders and rounding",
    icon: Icon.Minus,
    rules: ["border_size 0", "rounding 0"],
  },
  {
    id: "no-shadow",
    name: "No Shadow",
    description: "Disable window shadow",
    icon: Icon.Moon,
    rules: ["no_shadow on"],
  },
  {
    id: "force-opaque",
    name: "Force Opaque",
    description: "Override opacity to 100% (disable transparency)",
    icon: Icon.Eye,
    rules: ["opacity 1.0 override 1.0 override"],
  },
  {
    id: "save-state",
    name: "Save Window State",
    description: "Remember window size and position (saves to window-state.conf)",
    icon: Icon.SaveDocument,
    rules: [], // Special profile - doesn't write rules
  },
];

export default function Command() {
  const [windowInfo, setWindowInfo] = useState<HyprpropWindowInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<WindowRuleProfile | null>(null);
  const [selector, setSelector] = useState<RuleSelector>("class");

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
    setIsLoading(false);
  }, [fetchWindowInfo]);

  useEffect(() => {
    loadWindowInfo();
  }, [loadWindowInfo]);

  const generateRuleLine = (profile: WindowRuleProfile, info: HyprpropWindowInfo, sel: RuleSelector): string => {
    const lines: string[] = [];
    
    // Use both initial_class and initial_title for guaranteed specificity
    const initialClass = escapeRegex(info.initialClass);
    const initialTitle = escapeRegex(info.initialTitle);
    
    lines.push(`# Generated by hypr-quickrule for ${info.initialClass} - ${info.initialTitle}`);
    
    for (const rule of profile.rules) {
      // Generate rule with both matchers for maximum specificity
      lines.push(`windowrule = match:initial_class ^(${initialClass})$ match:initial_title ^(${initialTitle})$, ${rule}`);
    }
    
    return lines.join("\n");
  };

  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const saveWindowState = async (info: HyprpropWindowInfo, sel: RuleSelector) => {
    try {
      const windowStateConfigPath = join(homedir(), ".config/hypr/window-state.conf");
      
      let matchValue = "";
      switch (sel) {
        case "class":
          matchValue = info.class;
          break;
        case "initial_class":
          matchValue = info.initialClass;
          break;
        case "title":
          matchValue = info.title;
          break;
        case "initial_title":
          matchValue = info.initialTitle;
          break;
      }

      // Read existing window state config
      let existingConfig = "";
      try {
        existingConfig = await fs.readFile(windowStateConfigPath, "utf-8");
      } catch {
        // File doesn't exist, create with header
        existingConfig = `# Window State Persistence Configuration
# Format: <matcher> <pattern>
# Supported matchers: match:class, match:title, match:initialClass, match:initialTitle
# Examples:
#   match:class xdg-desktop-portal-gtk
#   match:class org\\.gnome\\..*
#   match:initialTitle ^Bitwarden
#   match:class Mullvad VPN

`;
      }

      // Check if this matcher already exists
      const matcherLine = `match:${sel} ${escapeRegex(matchValue)}`;
      const matcherLinePattern = new RegExp(`^match:${sel}\\s+${escapeRegex(matchValue).replace(/\\\\/g, "\\\\\\\\")}\\s*$`, "m");
      
      if (matcherLinePattern.test(existingConfig)) {
        await showToast({
          style: Toast.Style.Success,
          title: "Window State Already Saved",
          message: `${matchValue} is already in window-state.conf`,
        });
        await closeMainWindow();
        return;
      }

      // Append new matcher with comment
      const newContent = existingConfig + `\n# ${matchValue}\n${matcherLine}\n`;
      await fs.writeFile(windowStateConfigPath, newContent, "utf-8");

      await showToast({
        style: Toast.Style.Success,
        title: "Window State Saved",
        message: `Added ${matchValue} to window-state.conf`,
      });

      await closeMainWindow();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to save window state",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const applyRule = async (profile: WindowRuleProfile, info: HyprpropWindowInfo, sel: RuleSelector) => {
    // Special handling for save-state profile
    if (profile.id === "save-state") {
      await saveWindowState(info, sel);
      return;
    }

    try {
      const hyprConfigPath = join(homedir(), ".config/hypr/generated-rules.conf");
      const ruleLine = generateRuleLine(profile, info, sel);

      // Read existing rules if file exists
      let existingRules = "";
      try {
        existingRules = await fs.readFile(hyprConfigPath, "utf-8");
      } catch {
        // File doesn't exist, will create new one
        existingRules = "# Auto-generated window rules by hypr-quickrule\n# Do not edit manually\n\n";
      }

      // Append new rule
      const newContent = existingRules + "\n" + ruleLine + "\n";
      await fs.writeFile(hyprConfigPath, newContent, "utf-8");

      // Reload Hyprland config
      await execAsync("hyprctl reload");

      await showToast({
        style: Toast.Style.Success,
        title: "Rule Applied",
        message: `Applied "${profile.name}" to ${info.initialClass}`,
      });

      await closeMainWindow();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to apply rule",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (isLoading) {
    return (
      <List isLoading={true}>
        <List.EmptyView
          title="Select a Window"
          description="Hyprprop is waiting for you to select a window..."
          icon={Icon.AppWindow}
        />
      </List>
    );
  }

  if (!windowInfo) {
    return (
      <List>
        <List.EmptyView
          title="No Window Selected"
          description="Failed to retrieve window information. Please try again."
          icon={Icon.XMarkCircle}
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
      </List>
    );
  }

  const getSelectorValue = (sel: RuleSelector): string => {
    switch (sel) {
      case "class":
        return windowInfo.class;
      case "initial_class":
        return windowInfo.initialClass;
      case "title":
        return windowInfo.title;
      case "initial_title":
        return windowInfo.initialTitle;
    }
  };

  return (
    <List
      navigationTitle={`Apply Rule to: ${windowInfo.class}`}
      searchBarPlaceholder="Search rule profiles..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Match By"
          value={selector}
          onChange={(newValue) => setSelector(newValue as RuleSelector)}
        >
          <List.Dropdown.Item title={`Class (${windowInfo.class})`} value="class" />
          <List.Dropdown.Item title={`Initial Class (${windowInfo.initialClass})`} value="initial_class" />
          <List.Dropdown.Item title={`Title (${windowInfo.title})`} value="title" />
          <List.Dropdown.Item title={`Initial Title (${windowInfo.initialTitle})`} value="initial_title" />
        </List.Dropdown>
      }
    >
      <List.Section title="Window Information">
        <List.Item
          title={windowInfo.class}
          subtitle={`${windowInfo.title} • PID ${windowInfo.pid}`}
          icon={{ source: Icon.Info, tintColor: Color.Blue }}
          accessories={[
            { text: `Workspace ${windowInfo.workspace.name}` },
            { text: windowInfo.floating ? "Floating" : "Tiled" },
            { text: windowInfo.xwayland ? "XWayland" : "Wayland" },
          ]}
        />
      </List.Section>
      <List.Section title="Rule Profiles" subtitle={`Applying to: ${getSelectorValue(selector)}`}>
        {RULE_PROFILES.map((profile) => (
          <List.Item
            key={profile.id}
            title={profile.name}
            subtitle={profile.description}
            icon={{ source: profile.icon, tintColor: profile.id === "save-state" ? Color.Blue : Color.Green }}
            accessories={[{ text: profile.id === "save-state" ? "Persistence" : `${profile.rules.length} rules` }]}
            actions={
              <ActionPanel>
                <Action
                  title={profile.id === "save-state" ? "Save Window State" : "Apply Rule"}
                  icon={profile.id === "save-state" ? Icon.SaveDocument : Icon.CheckCircle}
                  onAction={() => applyRule(profile, windowInfo, selector)}
                />
                {profile.id !== "save-state" && (
                  <Action
                    title="Preview Rules"
                    icon={Icon.Eye}
                    onAction={() => setSelectedProfile(profile)}
                    shortcut={{ modifiers: ["cmd"], key: "p" }}
                  />
                )}
                <ActionPanel.Section>
                  <Action
                    title="Retry Window Selection"
                    icon={Icon.ArrowClockwise}
                    onAction={loadWindowInfo}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {selectedProfile && selectedProfile.id !== "save-state" && (
        <List.Section title={`Preview: ${selectedProfile.name}`}>
          {selectedProfile.rules.map((rule, index) => (
            <List.Item
              key={index}
              title={rule}
              icon={{ source: Icon.Code, tintColor: Color.Orange }}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
