import React from "react";
import { Grid, ActionPanel, Action, Icon, LocalStorage } from "@vicinae/api";

const RECENT_ICONS_KEY = "recentIconsData";
const MAX_RECENT_ICONS = 20;

type RecentIcon = Pick<IconEntry, "id" | "char" | "code" | "displayName" | "nerdFontId" | "packLabel" | "iconPath">;

type GlyphRecord = Record<string, { char: string; code: string }>;

let cachedGlyphnames: GlyphRecord | null = null;
let iconCache = new Map<string, IconEntry>();

async function loadGlyphnames(): Promise<GlyphRecord> {
  if (cachedGlyphnames) {
    return cachedGlyphnames;
  }
  
  const glyphnamesData = await import("../assets/glyphnames.json");
  cachedGlyphnames = glyphnamesData.default as unknown as GlyphRecord;
  return cachedGlyphnames;
}

type IconEntry = {
  id: string;
  pack: string;
  packLabel: string;
  displayName: string;
  char: string;
  code: string;
  hexCode: string;
  htmlEntity: string;
  nerdFontId: string;
  keywords: string[];
  markdown: string;
  iconPath: string;
};

type IconIndex = {
  id: string;
  pack: string;
  char: string;
  code: string;
  searchTokens: string[];
};

const PACK_LABELS: Record<string, string> = {
  cod: "VS Code Codicons",
  custom: "Custom Icons",
  dev: "Devicons",
  extra: "Nerd Font Extras",
  fa: "Font Awesome",
  fae: "Font Awesome Extension",
  iec: "IEC Power",
  indent: "Indent Icons",
  indentation: "Indentation Icons",
  linux: "Linux Logos",
  md: "Material Design",
  oct: "GitHub Octicons",
  pl: "Powerline",
  ple: "Powerline Extra",
  pom: "Pomicons",
  seti: "Seti UI",
  weather: "Weather Icons",
};

async function buildIconIndex(): Promise<IconIndex[]> {
  const [glyphnamesData, { addSynonyms }] = await Promise.all([
    loadGlyphnames(),
    import("./synonyms"),
  ]);
  
  const { METADATA: _metadata, ...rawGlyphs } = glyphnamesData as GlyphRecord & {
    METADATA?: unknown;
  };

  return Object.entries(rawGlyphs)
    .filter(([id]) => id !== "METADATA")
    .map(([id, glyph]) => {
      const [pack, ...rest] = id.split("-");
      const rawName = rest.join("-");
      const words = splitNameIntoWords(rawName);
      
      // Build minimal search tokens
      const searchTokens = new Set<string>();
      searchTokens.add(id.toLowerCase());
      searchTokens.add(pack.toLowerCase());
      searchTokens.add(rawName.toLowerCase().replace(/_/g, " "));
      words.forEach(word => {
        const normalized = word.toLowerCase();
        searchTokens.add(normalized);
        addSynonyms(normalized).forEach(s => searchTokens.add(s));
      });
      
      return {
        id,
        pack,
        char: glyph.char,
        code: glyph.code,
        searchTokens: Array.from(searchTokens),
      };
    });
}

async function getIconEntry(index: IconIndex, glyphnames: GlyphRecord): Promise<IconEntry> {
  // Check cache first
  if (iconCache.has(index.id)) {
    return iconCache.get(index.id)!;
  }
  
  // Create full entry on demand
  const glyph = glyphnames[index.id];
  const entry = await createIconEntry(index.id, glyph);
  
  // Cache it
  iconCache.set(index.id, entry);
  
  return entry;
}

function getPackFilterOptions(iconIndex: IconIndex[]) {
  const packOptions = iconIndex.reduce<Record<string, string>>((acc, icon) => {
    if (!acc[icon.pack]) {
      acc[icon.pack] = PACK_LABELS[icon.pack] ?? icon.pack.toUpperCase();
    }
    return acc;
  }, {});

  return Object.entries(packOptions)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default function NerdFontSearch() {
  const [selectedPack, setSelectedPack] = React.useState<string>("all");
  const [iconIndex, setIconIndex] = React.useState<IconIndex[]>([]);
  const [glyphnames, setGlyphnames] = React.useState<GlyphRecord | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchText, setSearchText] = React.useState<string>("");
  const [recentIcons, setRecentIcons] = React.useState<RecentIcon[]>([]);
  const [filteredIcons, setFilteredIcons] = React.useState<IconEntry[]>([]);

  const debouncedSearch = useDebounce(searchText, 300);

  // Load recent icons immediately (no dependency on icon index)
  React.useEffect(() => {
    LocalStorage.getItem<string>(RECENT_ICONS_KEY).then((stored) => {
      if (stored) {
        try {
          const recent = JSON.parse(stored) as RecentIcon[];
          setRecentIcons(recent);
          // Show recent icons immediately
          setFilteredIcons(recent as IconEntry[]);
          setIsLoading(false);
        } catch {
          setRecentIcons([]);
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  // Load full index only when user starts searching
  React.useEffect(() => {
    if (debouncedSearch.length >= 3 && iconIndex.length === 0) {
      let cancelled = false;

      const loadData = async () => {
        const [index, glyphs] = await Promise.all([
          buildIconIndex(),
          loadGlyphnames(),
        ]);
        
        if (!cancelled) {
          setIconIndex(index);
          setGlyphnames(glyphs);
        }
      };

      loadData();

      return () => {
        cancelled = true;
      };
    }
  }, [debouncedSearch, iconIndex.length]);

  const packFilterOptions = React.useMemo(
    () => (iconIndex.length > 0 ? getPackFilterOptions(iconIndex) : []),
    [iconIndex]
  );

  // Filtered index (lightweight, sync) - only when searching
  const filteredIndex = React.useMemo(() => {
    // Show recent icons when not searching
    if (debouncedSearch.length === 0) {
      return [];
    }

    if (debouncedSearch.length < 3 || iconIndex.length === 0) {
      return [];
    }

    let filtered = iconIndex;

    if (selectedPack !== "all") {
      filtered = filtered.filter((idx) => idx.pack === selectedPack);
    }

    const searchLower = debouncedSearch.toLowerCase();
    return filtered.filter((idx) =>
      idx.searchTokens.some((token) => token.includes(searchLower))
    );
  }, [iconIndex, selectedPack, debouncedSearch]);

  // Convert filtered index to full entries (async) - only when searching
  React.useEffect(() => {
    if (debouncedSearch.length === 0) {
      // Show recent icons when not searching
      setFilteredIcons(recentIcons as IconEntry[]);
      return;
    }

    if (debouncedSearch.length < 3) {
      setFilteredIcons([]);
      return;
    }

    if (!glyphnames || filteredIndex.length === 0) {
      setFilteredIcons([]);
      return;
    }
    
    let cancelled = false;
    
    Promise.all(filteredIndex.map(idx => getIconEntry(idx, glyphnames)))
      .then(entries => {
        if (!cancelled) {
          setFilteredIcons(entries);
        }
      });
    
    return () => {
      cancelled = true;
    };
  }, [filteredIndex, glyphnames, debouncedSearch, recentIcons]);

  const addRecentIcon = React.useCallback(
    (icon: IconEntry) => {
      const recentIcon: RecentIcon = {
        id: icon.id,
        char: icon.char,
        code: icon.code,
        displayName: icon.displayName,
        nerdFontId: icon.nerdFontId,
        packLabel: icon.packLabel,
        iconPath: icon.iconPath,
      };

      const updated = [
        recentIcon,
        ...recentIcons.filter((r) => r.id !== icon.id)
      ].slice(0, MAX_RECENT_ICONS);

      setRecentIcons(updated);
      LocalStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(updated));
    },
    [recentIcons]
  );

  return (
    <Grid
      columns={8}
      fit={Grid.Fit.Contain}
      aspectRatio="1"
      filtering
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder='Search Nerd Font icons (min 3 characters)'
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="Filter by icon pack"
          storeValue
          onChange={setSelectedPack}
          value={selectedPack}
        >
          <Grid.Dropdown.Item title="All icon packs" value="all" />
          {packFilterOptions.map((option) => (
            <Grid.Dropdown.Item
              key={option.value}
              title={option.label}
              value={option.value}
            />
          ))}
        </Grid.Dropdown>
      }
    >
      {filteredIcons.length === 0 ? (
        <Grid.EmptyView
          title={
            debouncedSearch.length > 0 && debouncedSearch.length < 3
              ? "Keep typing..."
              : debouncedSearch.length >= 3
              ? "No icons found"
              : "Start searching"
          }
          description={
            debouncedSearch.length > 0 && debouncedSearch.length < 3
              ? "Enter at least 3 characters to search"
              : debouncedSearch.length >= 3
              ? "Try a different search term or pick another icon pack"
              : recentIcons.length > 0
              ? "Your recently copied icons will appear here"
              : "Enter at least 3 characters to search for icons"
          }
          icon={Icon.MagnifyingGlass}
        />
      ) : (
        <Grid.Section
          title={
            debouncedSearch.length === 0 && recentIcons.length > 0
              ? "Recently Copied"
              : selectedPack === "all"
              ? "All icon packs"
              : (PACK_LABELS[selectedPack] ?? selectedPack.toUpperCase())
          }
          subtitle={`${filteredIcons.length.toLocaleString()} icons`}
        >
          {filteredIcons.map((icon) => (
            <Grid.Item
              key={icon.id}
              id={icon.id}
              content={icon.iconPath}
              title={icon.displayName}
              subtitle={icon.nerdFontId}
              keywords={icon.keywords || []}
              actions={<IconActions icon={icon} onCopy={() => addRecentIcon(icon)} />}
            />
          ))}
        </Grid.Section>
      )}
    </Grid>
  );
}

function IconActions({ icon, onCopy }: { icon: IconEntry; onCopy: () => void }) {
  return (
    <ActionPanel>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy glyph"
          content={icon.char}
          icon={Icon.CopyClipboard}
          onCopy={onCopy}
        />
        <Action.CopyToClipboard
          title="Copy Nerd Font name"
          content={icon.nerdFontId}
          icon={Icon.Hashtag}
          onCopy={onCopy}
        />
        <Action.CopyToClipboard
          title="Copy identifier"
          content={icon.id}
          icon={Icon.Document}
          onCopy={onCopy}
        />
        <Action.CopyToClipboard
          title="Copy Unicode codepoint"
          content={icon.hexCode}
          icon={Icon.Terminal}
          onCopy={onCopy}
        />
        <Action.CopyToClipboard
          title="Copy HTML entity"
          content={icon.htmlEntity}
          icon={Icon.Globe}
          onCopy={onCopy}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

function getColorForIcon(code: string): string {
  const colorHash = parseInt(code.substring(0, 6), 16) % 360;
  return `hsl(${colorHash}, 70%, 60%)`;
}

function createIconDataURL(char: string, code: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><text x="128" y="180" font-family="JetBrainsMono Nerd Font Mono,Symbols Nerd Font Mono,monospace" font-size="160" text-anchor="middle" fill="white" font-weight="normal">${char}</text></svg>`;
  
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

async function createIconEntry(
  id: string,
  glyph: { char: string; code: string },
): Promise<IconEntry> {
  const { addSynonyms } = await import("./synonyms");
  
  const [pack, ...rest] = id.split("-");
  const rawName = rest.join("-");
  const packLabel = PACK_LABELS[pack] ?? pack.toUpperCase();
  const words = splitNameIntoWords(rawName);
  const displayName =
    words.length > 0 
      ? (await Promise.all(words.map(toTitleCase))).join(" ")
      : await toTitleCase(pack);

  const codeUpper = glyph.code.toUpperCase();
  const nerdFontId = `nf-${id.replace(/_/g, "-")}`;
  const htmlEntity = `&#x${glyph.code};`;
  const iconPath = createIconDataURL(glyph.char, glyph.code);
  const keywordSet = new Set<string>();

  keywordSet.add(id.toLowerCase());
  keywordSet.add(id.replace(/_/g, " ").toLowerCase());
  keywordSet.add(nerdFontId.toLowerCase());
  keywordSet.add(nerdFontId.replace(/-/g, " "));
  keywordSet.add(pack.toLowerCase());
  keywordSet.add(packLabel.toLowerCase());
  packLabel
    .toLowerCase()
    .split(/\s+/)
    .forEach((token) => {
      if (token) {
        keywordSet.add(token);
      }
    });
  keywordSet.add(glyph.code.toLowerCase());
  keywordSet.add(codeUpper);
  keywordSet.add(`0x${glyph.code.toLowerCase()}`);
  keywordSet.add(`0x${codeUpper}`);
  keywordSet.add(`\\u${codeUpper}`);
  keywordSet.add(htmlEntity.toLowerCase());
  keywordSet.add(htmlEntity);
  keywordSet.add(displayName.toLowerCase());

  words.forEach((word) => {
    const normalized = word.toLowerCase();
    keywordSet.add(normalized);

    if (normalized.includes("+")) {
      keywordSet.add(normalized.replace("+", "plus"));
      keywordSet.add("+");
    }
    if (normalized.includes("-")) {
      keywordSet.add(normalized.replace("-", " "));
    }

    addSynonyms(normalized).forEach((synonym) => keywordSet.add(synonym));
  });

  const markdown = [
    `# ${glyph.char} ${displayName}`,
    "",
    `- **Nerd Font name:** \`${nerdFontId}\``,
    `- **Identifier:** \`${id}\``,
    `- **Icon pack:** ${packLabel}`,
    `- **Unicode:** \`0x${codeUpper}\``,
    `- **HTML entity:** \`${htmlEntity}\``,
  ].join("\n");

  return {
    id,
    pack,
    packLabel,
    displayName,
    char: glyph.char,
    code: glyph.code,
    hexCode: `0x${codeUpper}`,
    htmlEntity,
    nerdFontId,
    keywords: Array.from(keywordSet),
    markdown,
    iconPath,
  };
}

function splitNameIntoWords(value: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[_-]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function toTitleCase(word: string): Promise<string> {
  const lower = word.toLowerCase();

  const { ACRONYMS } = await import("./synonyms");
  
  if (ACRONYMS.has(lower)) {
    return lower.toUpperCase();
  }

  if (/^\d+$/.test(word)) {
    return word;
  }

  if (word.length <= 2) {
    return word.toUpperCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1);
}
