import React from "react";
import { Grid, ActionPanel, Action, Icon, LocalStorage } from "@vicinae/api";

const RECENT_ICONS_KEY = "recentIcons";
const MAX_RECENT_ICONS = 20;

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

const ACRONYMS = new Set([
  "api",
  "aws",
  "css",
  "cpu",
  "db",
  "dev",
  "doc",
  "gpu",
  "html",
  "id",
  "ip",
  "js",
  "nfc",
  "npm",
  "pdf",
  "sql",
  "ui",
  "url",
  "usb",
  "vm",
  "vpn",
  "xml",
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  account: ["user", "profile", "person", "avatar"],
  add: ["plus", "new"],
  alert: ["warning", "caution", "triangle"],
  anchor: ["ship", "boat"],
  app: ["application", "program"],
  arrow: ["direction", "chevron", "pointer"],
  audio: ["sound", "speaker", "volume"],
  back: ["previous", "left"],
  bell: ["notification", "alert"],
  bird: ["animal"],
  bolt: ["lightning", "electric", "flash"],
  book: ["read", "library", "manual"],
  box: ["container", "package"],
  bug: ["issue", "defect", "problem"],
  bulb: ["idea", "light"],
  camera: ["photo", "picture"],
  cancel: ["close", "stop", "abort"],
  car: ["vehicle", "auto"],
  cart: ["shopping", "basket"],
  certificate: ["badge", "award"],
  chat: ["message", "speech", "bubble"],
  check: ["tick", "confirm", "done", "ok", "success"],
  circle: ["round", "button"],
  clipboard: ["copy", "paste"],
  close: ["cross", "cancel", "x"],
  cloud: ["upload", "download", "storage"],
  code: ["developer", "program"],
  cog: ["settings", "gear", "preferences"],
  column: ["layout"],
  comment: ["message", "chat"],
  compass: ["navigation", "direction"],
  copy: ["duplicate", "clone"],
  cpu: ["processor", "chip"],
  cross: ["close", "cancel", "multiply"],
  delete: ["remove", "trash", "bin"],
  desktop: ["computer", "monitor"],
  document: ["file", "paper"],
  download: ["save", "arrow down"],
  edit: ["pencil", "write"],
  email: ["mail", "envelope"],
  error: ["issue", "problem", "warning"],
  exit: ["logout", "leave"],
  file: ["document", "paper"],
  filter: ["funnel", "narrow"],
  flag: ["marker", "milestone"],
  folder: ["directory"],
  forward: ["next", "right"],
  gift: ["present"],
  globe: ["world", "earth"],
  graph: ["chart"],
  grid: ["layout"],
  heart: ["like", "love", "favorite"],
  help: ["question", "support"],
  home: ["house"],
  image: ["picture", "photo"],
  info: ["information", "details"],
  light: ["sun", "bright"],
  link: ["chain", "url"],
  list: ["menu", "items", "bullet"],
  lock: ["secure", "security"],
  login: ["sign in"],
  logout: ["sign out", "exit"],
  magnifier: ["search", "find"],
  menu: ["hamburger", "navigation"],
  message: ["chat", "speech"],
  microphone: ["audio", "voice", "record"],
  minus: ["remove", "dash"],
  moon: ["night", "dark"],
  music: ["audio", "note", "song"],
  mute: ["silent", "speaker"],
  notification: ["alert", "bell"],
  open: ["unlock"],
  palette: ["color", "paint"],
  paperclip: ["attachment"],
  pause: ["stop"],
  pay: ["money", "currency"],
  pen: ["edit", "write", "pencil"],
  pencil: ["edit", "draw", "write"],
  people: ["users", "group", "team"],
  phone: ["call", "telephone"],
  picture: ["photo", "image"],
  play: ["start", "triangle"],
  plug: ["power", "electric"],
  plus: ["add", "new"],
  power: ["shutdown", "off"],
  print: ["printer"],
  question: ["help", "support"],
  redo: ["forward", "arrow"],
  refresh: ["reload", "sync", "update"],
  remove: ["delete", "trash"],
  repeat: ["loop"],
  reply: ["answer"],
  rocket: ["ship", "launch"],
  save: ["disk"],
  search: ["find", "magnifying", "magnifier"],
  settings: ["cog", "gear", "preferences"],
  share: ["export", "send"],
  shield: ["security", "protection"],
  skip: ["jump"],
  sort: ["order"],
  speaker: ["audio", "sound", "volume"],
  star: ["favorite", "bookmark", "rating"],
  status: ["indicator"],
  stop: ["square", "halt"],
  sun: ["day", "light"],
  sync: ["refresh", "reload", "update"],
  tag: ["label", "badge"],
  target: ["aim", "bullseye"],
  terminal: ["cli", "command", "prompt"],
  text: ["font", "type"],
  time: ["clock", "schedule"],
  timer: ["clock", "alarm"],
  toggle: ["switch"],
  trash: ["delete", "remove", "bin"],
  unlock: ["access", "open"],
  update: ["refresh", "sync"],
  upload: ["arrow up"],
  user: ["person", "account", "profile"],
  video: ["movie", "camera"],
  volume: ["speaker", "sound", "audio"],
  warning: ["alert", "triangle"],
  wifi: ["network", "signal"],
  window: ["app", "application"],
  write: ["edit", "pencil"],
  x: ["close", "cancel", "cross"],
  dog: ["puppy", "animal", "pet"],
  cat: ["kitten", "animal", "pet"],
  left: ["previous", "west", "back"],
  right: ["next", "east", "forward"],
  up: ["north", "increase", "raise"],
  down: ["south", "decrease", "lower"],
  times: ["close", "cross", "multiply"],
  lightning: ["bolt", "electric"],
};

async function buildIconIndex(): Promise<IconIndex[]> {
  const glyphnamesData = await loadGlyphnames();
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

function getIconEntry(index: IconIndex, glyphnames: GlyphRecord): IconEntry {
  // Check cache first
  if (iconCache.has(index.id)) {
    return iconCache.get(index.id)!;
  }
  
  // Create full entry on demand
  const glyph = glyphnames[index.id];
  const entry = createIconEntry(index.id, glyph);
  
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

export default function NerdFontSearch() {
  const [selectedPack, setSelectedPack] = React.useState<string>("all");
  const [iconIndex, setIconIndex] = React.useState<IconIndex[]>([]);
  const [glyphnames, setGlyphnames] = React.useState<GlyphRecord | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchText, setSearchText] = React.useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = React.useState<string>("");
  const [recentIconIds, setRecentIconIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      const [index, glyphs] = await Promise.all([
        buildIconIndex(),
        loadGlyphnames(),
      ]);
      
      if (!cancelled) {
        setIconIndex(index);
        setGlyphnames(glyphs);
        setIsLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    LocalStorage.getItem<string>(RECENT_ICONS_KEY).then((stored) => {
      if (stored) {
        try {
          setRecentIconIds(JSON.parse(stored));
        } catch (e) {
          setRecentIconIds([]);
        }
      }
    });
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText]);

  const packFilterOptions = React.useMemo(
    () => (iconIndex.length > 0 ? getPackFilterOptions(iconIndex) : []),
    [iconIndex]
  );

  const filteredIcons = React.useMemo(() => {
    if (!glyphnames) return [];
    
    let filtered = iconIndex;

    if (selectedPack !== "all") {
      filtered = filtered.filter((idx) => idx.pack === selectedPack);
    }

    if (debouncedSearch.length >= 3) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter((idx) =>
        idx.searchTokens.some((token) => token.includes(searchLower))
      );
    } else if (debouncedSearch.length === 0 && recentIconIds.length > 0) {
      const recentIndices = recentIconIds
        .map((id) => filtered.find((idx) => idx.id === id))
        .filter((idx): idx is IconIndex => idx !== undefined);
      return recentIndices.map(idx => getIconEntry(idx, glyphnames));
    } else {
      return [];
    }

    // Convert index to full IconEntry only for displayed results
    return filtered.map(idx => getIconEntry(idx, glyphnames));
  }, [selectedPack, iconIndex, glyphnames, debouncedSearch, recentIconIds]);

  const addRecentIcon = React.useCallback(
    (iconId: string) => {
      const updated = [iconId, ...recentIconIds.filter((id) => id !== iconId)].slice(
        0,
        MAX_RECENT_ICONS
      );
      setRecentIconIds(updated);
      LocalStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(updated));
    },
    [recentIconIds]
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
              : recentIconIds.length > 0
              ? "Your recently copied icons will appear here"
              : "Enter at least 3 characters to search for icons"
          }
          icon={Icon.MagnifyingGlass}
        />
      ) : (
        <Grid.Section
          title={
            debouncedSearch.length === 0 && recentIconIds.length > 0
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
              keywords={icon.keywords}
              actions={<IconActions icon={icon} onCopy={() => addRecentIcon(icon.id)} />}
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

function createIconEntry(
  id: string,
  glyph: { char: string; code: string },
): IconEntry {
  const [pack, ...rest] = id.split("-");
  const rawName = rest.join("-");
  const packLabel = PACK_LABELS[pack] ?? pack.toUpperCase();
  const words = splitNameIntoWords(rawName);
  const displayName =
    words.length > 0 ? words.map(toTitleCase).join(" ") : toTitleCase(pack);

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

function toTitleCase(word: string): string {
  const lower = word.toLowerCase();

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

function addSynonyms(token: string): string[] {
  const synonyms = TOKEN_SYNONYMS[token] ?? [];
  const extras: string[] = [];

  if (token === "plus") {
    extras.push("+", "add");
  }
  if (token === "minus") {
    extras.push("-", "subtract");
  }
  if (token === "times") {
    extras.push("x");
  }
  if (token === "close") {
    extras.push("quit");
  }

  return [...synonyms, ...extras].map((entry) => entry.toLowerCase());
}
