import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { ProjectReference } from "./types";

export function createReferenceAutocompleteProvider(
  provider: AutocompleteProvider,
  references: readonly ProjectReference[],
): AutocompleteProvider {
  const referenceProvider: AutocompleteProvider = {
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, options);
      const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
      const quotedMatch = /(?:^|\s)(@"([^"]*)$)/u.exec(textBeforeCursor);
      const plainMatch = /(?:^|\s)(@([^\s"]*)$)/u.exec(textBeforeCursor);
      const prefix = quotedMatch?.[1] ?? plainMatch?.[1];
      const query = quotedMatch?.[2] ?? plainMatch?.[2];
      if (prefix === undefined || query === undefined) return suggestions;

      const referenceItems = references
        .filter((reference) => reference.name.toLowerCase().startsWith(query.toLowerCase()))
        .map((reference): AutocompleteItem => {
          const value = /\s/u.test(reference.name) ? `@"${reference.name}"` : `@${reference.name}`;
          return {
            value,
            label: value,
            description: `Reference · ${reference.description}`,
          };
        });
      if (referenceItems.length === 0) return suggestions;

      const existingItems = suggestions?.items ?? [];
      const existingValues = new Set(existingItems.map((item) => item.value));

      return {
        items: [
          ...referenceItems.filter((reference) => existingValues.has(reference.value) === false),
          ...existingItems,
        ],
        prefix,
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
  };
  referenceProvider.triggerCharacters = [...new Set([...(provider.triggerCharacters ?? []), "@"])];
  if (provider.shouldTriggerFileCompletion !== undefined) {
    referenceProvider.shouldTriggerFileCompletion = (lines, cursorLine, cursorCol) =>
      provider.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }
  return referenceProvider;
}
