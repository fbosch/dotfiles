import type {
  AutocompleteItem,
  AutocompleteProvider,
  Component,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@earendil-works/pi-tui";
import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { getCommandAlias } from "../command-aliases";
import type { AgentMention } from "../mentions/agent-mentions";
import {
  createReferenceAutocompleteProvider,
  type ProjectReference,
} from "../mentions/project-references";
import { fitColumns, paintDockRow } from "./dock-rendering";

type Color = (text: string) => string;
type AgentMentionFormatter = (mention: AgentMention, text: string) => string;

interface AutocompleteOverlayStyle {
  rail: string;
  rightBorder: string;
  backgroundAnsi: string;
  selectedBackgroundAnsi: string;
  selectedForegroundAnsi: string;
}

interface AutocompleteOverlayComponent extends Component, AutocompleteOverlayStyle {
  lines: string[];
}

export function styleSelectedSuggestion(
  line: string,
  width: number,
  selectedBackgroundAnsi: string,
  selectedForegroundAnsi: string,
): string {
  const plain = stripTerminalSequences(line);
  const match = /^\s*→\s+(.*)$/.exec(plain);
  if (match === null) {
    const leadingWidth = plain.length - plain.trimStart().length;
    const paddingToRemove = Math.max(0, leadingWidth - 1);
    return sliceByColumn(line, paddingToRemove, visibleWidth(line) - paddingToRemove, true);
  }

  const content = fitColumns(` ${match[1] ?? ""}`, "", width);
  return `${selectedBackgroundAnsi}${selectedForegroundAnsi}${content}\u001b[39m\u001b[49m`;
}

function scrollIndicator(line: string): string | undefined {
  const match = /^─── ([↑↓]) (\d+) more(?: ─*)?$/.exec(stripTerminalSequences(line));
  if (match === null) return undefined;
  return `${match[1]} ${match[2]} more`;
}

export function splitEditorLines(
  lines: readonly string[],
  border: Color,
): { content: string[]; suggestions: string[] } {
  if (lines.length < 2) return { content: [...lines], suggestions: [] };

  const bottomBorder = findBottomBorder(lines, border);
  const editorLines = lines.slice(0, bottomBorder + 1);
  const suggestions = lines.slice(bottomBorder + 1);
  const content = editorLines.slice(1, -1);
  const topIndicator = editorLines[0] === undefined ? undefined : scrollIndicator(editorLines[0]);
  const bottomLine = editorLines[editorLines.length - 1];
  const bottomIndicator = bottomLine === undefined ? undefined : scrollIndicator(bottomLine);

  if (topIndicator !== undefined) content.unshift(topIndicator);
  if (bottomIndicator !== undefined) content.push(bottomIndicator);

  return { content, suggestions };
}

export function suggestionOverlayOffset(dockRowCount: number): number {
  return -(Math.max(0, dockRowCount) + 1);
}

export function findBottomBorder(lines: readonly string[], border: Color): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const plain = stripTerminalSequences(line);
    const isBorder = /^─+$/.test(plain) || /^─── [↑↓] \d+ more ─*$/.test(plain);
    const styledCells = [...plain].map(border).join("");
    if (isBorder && (line === border(plain) || line === styledCells)) return index;
  }

  return lines.length - 1;
}

export function createAliasAutocompleteProvider(
  provider: AutocompleteProvider,
  agentMentions: readonly AgentMention[] = [],
  formatAgentMention: AgentMentionFormatter = (_mention, text) => text,
): AutocompleteProvider {
  const aliasProvider: AutocompleteProvider = {
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, options);
      const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
      const agentPrefix = /(?:^|\s)(@[a-z0-9-]*)$/i.exec(textBeforeCursor)?.[1];
      const matchingAgents =
        agentPrefix === undefined
          ? []
          : agentMentions
              .filter((mention) =>
                mention.name.toLowerCase().startsWith(agentPrefix.slice(1).toLowerCase()),
              )
              .map(
                (mention): AutocompleteItem => ({
                  value: `@${mention.name}`,
                  label: formatAgentMention(mention, `@${mention.name}`),
                  description: `Agent · ${mention.description}`,
                }),
              );
      if (matchingAgents.length > 0 && agentPrefix !== undefined) {
        return {
          items: [
            ...matchingAgents,
            ...(suggestions?.items.filter(
              (suggestion) =>
                matchingAgents.some((agent) => agent.value === suggestion.value) === false,
            ) ?? []),
          ],
          prefix: agentPrefix,
        };
      }

      const alias = getCommandAlias(textBeforeCursor);
      if (alias === undefined) return suggestions;

      const item: AutocompleteItem = {
        value: alias.target.slice(1),
        label: alias.target.slice(1),
        description: alias.description,
      };
      if (suggestions === null) return { items: [item], prefix: textBeforeCursor };

      return {
        ...suggestions,
        items: [item, ...suggestions.items.filter((suggestion) => suggestion.value !== item.value)],
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
  };
  if (provider.triggerCharacters !== undefined) {
    aliasProvider.triggerCharacters = provider.triggerCharacters;
  }
  if (provider.shouldTriggerFileCompletion !== undefined) {
    aliasProvider.shouldTriggerFileCompletion = (lines, cursorLine, cursorCol) =>
      provider.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }

  return aliasProvider;
}

export function createPromptAutocompleteProvider(
  provider: AutocompleteProvider,
  agentMentions: readonly AgentMention[],
  projectReferences: readonly ProjectReference[],
  formatAgentMention: AgentMentionFormatter,
): AutocompleteProvider {
  const aliasProvider = createAliasAutocompleteProvider(
    provider,
    agentMentions,
    formatAgentMention,
  );
  return createReferenceAutocompleteProvider(aliasProvider, projectReferences);
}

export class AutocompleteOverlay {
  private readonly tui: TUI;
  private readonly component: AutocompleteOverlayComponent;
  private readonly options: OverlayOptions = {
    anchor: "bottom-left",
    col: 0,
    nonCapturing: true,
  };
  private handle: OverlayHandle | undefined;

  constructor(tui: TUI) {
    this.tui = tui;
    this.component = {
      lines: [],
      rail: "",
      rightBorder: "",
      backgroundAnsi: "",
      selectedBackgroundAnsi: "",
      selectedForegroundAnsi: "",
      render(width) {
        const contentWidth = Math.max(
          0,
          width - visibleWidth(this.rail) - visibleWidth(this.rightBorder),
        );
        return this.lines.map((line) => {
          const styledLine = styleSelectedSuggestion(
            line,
            contentWidth,
            this.selectedBackgroundAnsi,
            this.selectedForegroundAnsi,
          );
          return paintDockRow(styledLine, width, this.rail, this.backgroundAnsi, this.rightBorder);
        });
      },
      invalidate() {},
    };
  }

  update(
    suggestions: readonly string[],
    width: number,
    dockRowCount: number,
    style: AutocompleteOverlayStyle,
  ): void {
    this.component.lines = [...suggestions];
    if (suggestions.length === 0) {
      this.handle?.setHidden(true);
      return;
    }

    Object.assign(this.component, style);
    this.options.width = width;
    this.options.offsetY = suggestionOverlayOffset(dockRowCount);
    if (this.handle === undefined) {
      this.handle = this.tui.showOverlay(this.component, this.options);
      return;
    }

    this.handle.setHidden(false);
  }

  hide(): void {
    this.handle?.setHidden(true);
  }

  dispose(): void {
    this.handle?.hide();
    this.handle = undefined;
  }
}
