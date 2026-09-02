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
type MatchFormatter = (text: string) => string;

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

function preserveBold(text: string): string {
  return stripTerminalSequences(
    text.replaceAll("\u001b[1m", "\ufff0").replaceAll("\u001b[22m", "\ufff1"),
  )
    .replaceAll("\ufff0", "\u001b[1m")
    .replaceAll("\ufff1", "\u001b[22m");
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

  const suggestion = match[1] ?? "";
  const suggestionStart = match[0].length - suggestion.length;
  const styledSuggestion = preserveBold(
    sliceByColumn(line, suggestionStart, visibleWidth(line) - suggestionStart, true),
  );
  const content = fitColumns(` ${styledSuggestion}`, "", width);
  return `${selectedBackgroundAnsi}${selectedForegroundAnsi}${content}\u001b[22m\u001b[39m\u001b[49m`;
}

export function formatPathMatches(
  path: string,
  query: string,
  formatMatch: MatchFormatter,
): string {
  const pathCharacters = [...path];
  const queryCharacters = [...query.replaceAll("\\", "/")];
  if (queryCharacters.length === 0) return path;

  const matchedIndexes: number[] = [];
  let pathIndex = 0;
  for (const queryCharacter of queryCharacters) {
    while (
      pathIndex < pathCharacters.length &&
      pathCharacters[pathIndex]?.toLowerCase() !== queryCharacter.toLowerCase()
    ) {
      pathIndex += 1;
    }
    if (pathIndex === pathCharacters.length) return path;
    matchedIndexes.push(pathIndex);
    pathIndex += 1;
  }

  let formatted = "";
  let previousEnd = 0;
  for (let index = 0; index < matchedIndexes.length; ) {
    const runStart = matchedIndexes[index];
    if (runStart === undefined) break;

    let runEnd = runStart + 1;
    index += 1;
    while (matchedIndexes[index] === runEnd) {
      runEnd += 1;
      index += 1;
    }

    formatted += pathCharacters.slice(previousEnd, runStart).join("");
    formatted += formatMatch(pathCharacters.slice(runStart, runEnd).join(""));
    previousEnd = runEnd;
  }

  return formatted + pathCharacters.slice(previousEnd).join("");
}

function pathQuery(prefix: string): string | undefined {
  if (prefix.startsWith("@") === false) return undefined;

  let query = prefix.slice(1);
  if (query.startsWith('"')) query = query.slice(1);
  if (query.endsWith('"')) query = query.slice(0, -1);
  return query;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "");
}

function normalizedCompletionPath(value: string): string {
  let path = value.startsWith("@") ? value.slice(1) : value;
  if (path.startsWith('"')) path = path.slice(1);
  if (path.endsWith('"')) path = path.slice(0, -1);
  return normalizePath(path);
}

export function createPathDisplayAutocompleteProvider(
  provider: AutocompleteProvider,
  formatMatch: MatchFormatter,
): AutocompleteProvider {
  const originalItems = new WeakMap<AutocompleteItem, AutocompleteItem>();
  const pathProvider: AutocompleteProvider = {
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, options);
      const query = suggestions === null ? undefined : pathQuery(suggestions.prefix);
      if (suggestions === null || query === undefined) return suggestions;

      return {
        ...suggestions,
        items: suggestions.items.map((item) => {
          if (
            item.description === undefined ||
            normalizedCompletionPath(item.value) !== normalizePath(item.description)
          ) {
            return item;
          }

          const displayPath =
            item.label.endsWith("/") && item.description.endsWith("/") === false
              ? `${item.description}/`
              : item.description;
          const formattedItem: AutocompleteItem = {
            ...item,
            label: formatPathMatches(displayPath, query, formatMatch),
          };
          delete formattedItem.description;
          originalItems.set(formattedItem, item);
          return formattedItem;
        }),
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      provider.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        originalItems.get(item) ?? item,
        prefix,
      ),
  };
  if (provider.triggerCharacters !== undefined) {
    pathProvider.triggerCharacters = provider.triggerCharacters;
  }
  if (provider.shouldTriggerFileCompletion !== undefined) {
    pathProvider.shouldTriggerFileCompletion = (lines, cursorLine, cursorCol) =>
      provider.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }

  return pathProvider;
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
  formatPathMatch: MatchFormatter = (text) => text,
): AutocompleteProvider {
  const pathProvider = createPathDisplayAutocompleteProvider(provider, formatPathMatch);
  const aliasProvider = createAliasAutocompleteProvider(
    pathProvider,
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
