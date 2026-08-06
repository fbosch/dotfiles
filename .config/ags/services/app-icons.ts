import Gio from "gi://Gio?version=2.0";
import GioUnix from "gi://GioUnix?version=2.0";
import GLib from "gi://GLib?version=2.0";
import type Gtk from "gi://Gtk?version=4.0";

export type IconRef =
  | { kind: "theme"; name: string }
  | { kind: "file"; path: string };

export interface IconWindowInfo {
  class?: string;
  initialClass?: string;
  title?: string;
  initialTitle?: string;
  processExecutable?: string;
}

export interface IconResolutionRequest {
  candidates: string[];
  directIcon?: string;
  iconTheme?: Gtk.IconTheme | null;
}

export interface ResolvedDesktopApplication {
  desktopId: string;
  name: string;
  icon: IconRef | null;
}

type FaugusGame = {
  title?: string;
  path?: string;
  icon?: string;
};

type SteamApp = {
  appid: string;
  name: string;
  installdir: string;
};

type DesktopEntry = {
  desktopId: string;
  path: string;
  appInfo: GioUnix.DesktopAppInfo;
  startupWmClass: string | null;
  displayName: string;
  executable: string;
};

type DesktopApplicationMatch = {
  appInfo: GioUnix.DesktopAppInfo;
  desktopId: string;
};

const faugusGamesPath = `${GLib.get_home_dir()}/.config/faugus-launcher/games.json`;
const steamAppsPath = `${GLib.get_home_dir()}/.local/share/Steam/steamapps`;
const steamLibraryCachePath = `${GLib.get_home_dir()}/.local/share/Steam/appcache/librarycache`;
const waybarConfigPath = `${GLib.get_home_dir()}/.config/waybar/config`;
const desktopFileDirs = Array.from(new Set([
  `${GLib.get_user_data_dir()}/applications`,
  ...GLib.get_system_data_dirs().map((dir) => `${dir}/applications`),
]));
const iconCache = new Map<string, IconRef | null>();
const themeIconFileCache = new Map<string, string | null>();
let faugusGamesCache: FaugusGame[] | null = null;
let steamAppsCache: SteamApp[] | null = null;
let waybarAppIdMappingCache: Record<string, string> | null = null;
let desktopEntriesCache: DesktopEntry[] | null = null;
let desktopAppMonitor: Gio.AppInfoMonitor | null = null;

const genericWrapperClasses = [
  "gamescope",
  "steam",
  "wine",
  "lutris",
  "heroic",
  "bottles",
  "umu",
  "proton",
];

function fileExists(path: string): boolean {
  try {
    return Gio.File.new_for_path(path).query_exists(null);
  } catch {
    return false;
  }
}

export function setImageFile(image: Gtk.Image, path: string): void {
  try {
    image.set_from_file(path);
  } catch (e) {
    console.error(`Failed to load icon file ${path}:`, e);
  }
}

function iconRefFromGioIcon(icon: Gio.Icon | null): IconRef | null {
  if (!icon) return null;

  if (icon instanceof Gio.ThemedIcon) {
    const names = icon.get_names();
    if (names && names.length > 0) return { kind: "theme", name: names[0] };
  }

  if (icon instanceof Gio.FileIcon) {
    const path = icon.get_file().get_path();
    if (path && fileExists(path)) return { kind: "file", path };
  }

  return null;
}

function iconFromDesktopFile(path: string): IconRef | null {
  try {
    const [, contents] = Gio.File.new_for_path(path).load_contents(null);
    if (contents) {
      const iconName = desktopField(new TextDecoder().decode(contents), "Icon");
      if (iconName && !iconName.startsWith("/")) {
        const themeIcon = findThemeIconFile(iconName);
        if (themeIcon) return { kind: "file", path: themeIcon };
      }

      const steamIcon = iconName?.match(/^steam_icon_(\d+)$/);
      if (steamIcon) {
        const icon = getSteamLibraryIconForAppId(steamIcon[1]);
        if (icon) return icon;
      }
    }

    const appInfo = GioUnix.DesktopAppInfo.new_from_filename(path);
    if (!appInfo) return null;
    return iconRefFromGioIcon(appInfo.get_icon());
  } catch {
    return null;
  }
}

function desktopField(contents: string, key: string): string | null {
  const match = contents.match(new RegExp(`^${key}=([^\n]+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function scanDesktopEntries(
  rootDir: string,
  currentDir: string,
  entriesById: Map<string, DesktopEntry>,
  seenIds: Set<string>,
): void {
  let entries: Gio.FileEnumerator | null = null;
  try {
    entries = Gio.File.new_for_path(currentDir).enumerate_children(
      "standard::name,standard::type",
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    let entry = entries.next_file(null);
    while (entry) {
      const name = entry.get_name();
      const path = `${currentDir}/${name}`;
      if (entry.get_file_type() === Gio.FileType.DIRECTORY) {
        scanDesktopEntries(rootDir, path, entriesById, seenIds);
        entry = entries.next_file(null);
        continue;
      }
      if (!name.endsWith(".desktop")) {
        entry = entries.next_file(null);
        continue;
      }

      const desktopId = path.slice(rootDir.length + 1).replaceAll("/", "-");
      if (seenIds.has(desktopId)) {
        entry = entries.next_file(null);
        continue;
      }
      seenIds.add(desktopId);

      try {
        const appInfo = GioUnix.DesktopAppInfo.new_from_filename(path);
        if (!isLaunchableDesktopApplication(appInfo)) {
          entry = entries.next_file(null);
          continue;
        }
        entriesById.set(desktopId, {
          desktopId,
          path,
          appInfo,
          startupWmClass: appInfo.get_startup_wm_class(),
          displayName: appInfo.get_display_name(),
          executable: appInfo.get_executable(),
        });
      } catch {
        // Skip unreadable or invalid desktop entries.
      }
      entry = entries.next_file(null);
    }
  } catch {
    // XDG data directories may not contain an applications directory.
  } finally {
    try {
      entries?.close(null);
    } catch {
      // The enumerator may already be closed after an I/O failure.
    }
  }
}

function loadDesktopEntries(): DesktopEntry[] {
  if (desktopEntriesCache) return desktopEntriesCache;

  const entriesById = new Map<string, DesktopEntry>();
  const seenIds = new Set<string>();
  for (const dir of desktopFileDirs) {
    scanDesktopEntries(dir, dir, entriesById, seenIds);
  }

  if (!desktopAppMonitor) {
    desktopAppMonitor = Gio.AppInfoMonitor.get();
    desktopAppMonitor.connect("changed", () => {
      desktopEntriesCache = null;
      iconCache.clear();
    });
  }

  desktopEntriesCache = Array.from(entriesById.values());
  return desktopEntriesCache;
}

function getIconFromDesktopFiles(value: string): IconRef | null {
  const candidates = iconLookupCandidates(value);
  const normalizedCandidates = new Set(candidates.map(normalizeIconSearchTerm).filter((candidate) => candidate !== ""));
  if (normalizedCandidates.size === 0) return null;

  for (const dir of desktopFileDirs) {
    for (const candidate of candidates) {
      const path = `${dir}/${candidate}.desktop`;
      if (!fileExists(path)) continue;
      const icon = iconFromDesktopFile(path);
      if (icon) return icon;
    }
  }

  for (const entry of loadDesktopEntries()) {
    const lookupTerms = [
      entry.desktopId,
      entry.startupWmClass,
      entry.displayName,
      entry.executable,
    ].filter((term): term is string => Boolean(term));
    if (!lookupTerms.some((term) => normalizedCandidates.has(normalizeIconSearchTerm(term)))) continue;
    const icon = iconFromDesktopFile(entry.path);
    if (icon) return icon;
  }

  return null;
}

function loadFaugusGames(): FaugusGame[] {
  if (faugusGamesCache) return faugusGamesCache;

  try {
    const file = Gio.File.new_for_path(faugusGamesPath);
    const [success, contents] = file.load_contents(null);
    if (!success || !contents) {
      faugusGamesCache = [];
      return faugusGamesCache;
    }

    const parsed = JSON.parse(new TextDecoder().decode(contents));
    faugusGamesCache = Array.isArray(parsed) ? parsed : [];
    return faugusGamesCache;
  } catch {
    faugusGamesCache = [];
    return faugusGamesCache;
  }
}

function steamManifestField(contents: string, key: string): string {
  const match = contents.match(new RegExp(`"${key}"\\s+"([^"]+)"`));
  return match?.[1] ?? "";
}

function loadSteamApps(): SteamApp[] {
  if (steamAppsCache) return steamAppsCache;

  const apps: SteamApp[] = [];
  try {
    const directory = Gio.File.new_for_path(steamAppsPath);
    const entries = directory.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
    let entry = entries.next_file(null);
    while (entry) {
      const name = entry.get_name();
      if (name.startsWith("appmanifest_") && name.endsWith(".acf")) {
        const path = `${steamAppsPath}/${name}`;
        const [, contents] = Gio.File.new_for_path(path).load_contents(null);
        if (contents) {
          const text = new TextDecoder().decode(contents);
          const appid = steamManifestField(text, "appid");
          const appName = steamManifestField(text, "name");
          const installdir = steamManifestField(text, "installdir");
          if (appid && appName) {
            apps.push({ appid, name: appName, installdir });
          }
        }
      }
      entry = entries.next_file(null);
    }
    entries.close(null);
  } catch {
    // Steam may not be installed or may use another library path.
  }

  steamAppsCache = apps;
  return steamAppsCache;
}

function getSteamLibraryIconForCandidate(candidate: string): IconRef | null {
  const normalizedCandidates = [candidate, ...buildTitleCandidates(candidate)]
    .map(normalizeIconSearchTerm)
    .filter((value) => value !== "");
  if (normalizedCandidates.length === 0) return null;

  for (const app of loadSteamApps()) {
    const appCandidates = [app.name, app.installdir, app.appid]
      .filter((value) => value !== "")
      .map(normalizeIconSearchTerm);
    if (!appCandidates.some((value) => normalizedCandidates.includes(value))) continue;

    const icon = getSteamLibraryIconForAppId(app.appid);
    if (icon) return icon;
  }

  return null;
}

function getSteamLibraryIconForAppId(appid: string): IconRef | null {
  const themeIcon = getSteamThemeIconForAppId(appid);
  if (themeIcon) return themeIcon;

  const cacheDir = `${steamLibraryCachePath}/${appid}`;
  const coverPath = `${cacheDir}/library_600x900.jpg`;
  if (fileExists(coverPath)) return { kind: "file", path: coverPath };

  const logoPath = `${cacheDir}/logo.png`;
  if (fileExists(logoPath)) return { kind: "file", path: logoPath };

  const squareIcon = findSteamSquareIcon(cacheDir);
  if (squareIcon) return { kind: "file", path: squareIcon };

  return null;
}

function findThemeIconFile(iconName: string): string | null {
  const cachedIcon = themeIconFileCache.get(iconName);
  if (cachedIcon !== undefined) return cachedIcon;

  const iconDirs = [
    `${GLib.get_home_dir()}/.local/share/icons/hicolor`,
    `/etc/profiles/per-user/${GLib.get_user_name()}/share/icons/hicolor`,
    "/run/current-system/sw/share/icons/hicolor",
  ];

  for (const dir of iconDirs) {
    for (const size of ["512x512", "256x256", "128x128", "64x64", "48x48", "32x32", "16x16"]) {
      for (const extension of ["png", "svg", "jpg", "jpeg"]) {
        const path = `${dir}/${size}/apps/${iconName}.${extension}`;
        if (fileExists(path)) {
          themeIconFileCache.set(iconName, path);
          return path;
        }
      }
    }
  }

  themeIconFileCache.set(iconName, null);
  return null;
}

function getSteamThemeIconForAppId(appid: string): IconRef | null {
  const path = findThemeIconFile(`steam_icon_${appid}`);
  return path ? { kind: "file", path } : null;
}

function findSteamSquareIcon(cacheDir: string): string | null {
  try {
    const directory = Gio.File.new_for_path(cacheDir);
    const entries = directory.enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
    let entry = entries.next_file(null);
    while (entry) {
      const name = entry.get_name();
      if (entry.get_file_type() === Gio.FileType.REGULAR && name.endsWith(".jpg") && name !== "library_600x900.jpg" && name !== "library_hero.jpg" && name !== "library_hero_blur.jpg") {
        const path = `${cacheDir}/${name}`;
        entries.close(null);
        return path;
      }
      entry = entries.next_file(null);
    }
    entries.close(null);
  } catch {
    return null;
  }

  return null;
}

function loadWaybarAppIdMapping(): Record<string, string> {
  if (waybarAppIdMappingCache) return waybarAppIdMappingCache;

  try {
    const file = Gio.File.new_for_path(waybarConfigPath);
    const [success, contents] = file.load_contents(null);
    if (!success || !contents) {
      waybarAppIdMappingCache = {};
      return waybarAppIdMappingCache;
    }

    const text = new TextDecoder().decode(contents);
    const mappingBlock = text.match(/"app_ids-mapping"\s*:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    const mapping: Record<string, string> = {};
    const entryPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    for (const match of mappingBlock.matchAll(entryPattern)) {
      mapping[match[1].replace(/\\"/g, '"')] = match[2].replace(/\\"/g, '"');
    }

    waybarAppIdMappingCache = mapping;
    return waybarAppIdMappingCache;
  } catch {
    waybarAppIdMappingCache = {};
    return waybarAppIdMappingCache;
  }
}

function getWaybarMappedAppId(appId: string): string | null {
  if (!appId) return null;
  const mapping = loadWaybarAppIdMapping();
  return mapping[appId] ?? mapping[appId.toLowerCase()] ?? null;
}

function normalizeIconSearchTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function normalizeIconCandidate(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\(grabbed\)\s*$/i, "")
    .trim();
}

function buildTitleCandidates(title: string): string[] {
  const normalizedTitle = title.replace(/\s*\(grabbed\)\s*$/i, "").trim();
  if (!normalizedTitle) return [];

  const withoutTrailingParentheticals = normalizedTitle.replace(/(?:\s+\([^)]*\))+$/, "").trim();

  const parts = [
    normalizedTitle,
    withoutTrailingParentheticals,
    normalizedTitle.split(" - ")[0]?.trim() ?? "",
    normalizedTitle.split("-")[0]?.trim() ?? "",
    normalizedTitle.split(" — ")[0]?.trim() ?? "",
    normalizedTitle.split(":")[0]?.trim() ?? "",
  ].filter((part) => part !== "");

  const candidates: string[] = [];
  for (const part of parts) {
    const withoutTrailingVersion = part.replace(/\s+\d+(?:\.\d+)+(?:\b.*)?$/, "").trim();
    const withoutParentheticals = part.replace(/\s+\([^)]*\)/g, "").trim();
    const partCandidates = [part, withoutTrailingVersion, withoutParentheticals].filter(
      (candidate, index, candidates) => candidate !== "" && candidates.indexOf(candidate) === index,
    );

    for (const partCandidate of partCandidates) {
      const lowered = partCandidate.toLowerCase();
      candidates.push(
        partCandidate,
        lowered,
        lowered.replace(/\s+/g, "-"),
        lowered.replace(/\s+/g, "_"),
        lowered.replace(/[^a-z0-9]+/g, ""),
      );
    }
  }

  return Array.from(new Set(candidates.filter((candidate) => candidate !== "")));
}

function iconSearchCandidates(value: string): string[] {
  const normalized = normalizeIconCandidate(value);
  if (!normalized) return [];

  const lower = normalized.toLowerCase();
  const classWithoutSeparators = lower.replace(/[-_\s]+/g, "");
  const kebabFromCamel = normalized.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const kebabWithMergedBrand = kebabFromCamel.replace(/^([^-]+)-([^-]+)-(.+)$/, "$1$2-$3");

  return Array.from(
    new Set([
      normalized,
      lower,
      lower.replace(/\s+/g, "-"),
      lower.replace(/\s+/g, "_"),
      classWithoutSeparators,
      kebabFromCamel,
      kebabWithMergedBrand,
      kebabFromCamel.replace(/-/g, ""),
      ...lower.split(/\s+-\s+|\s+—\s+|\s*:\s*/).filter(Boolean),
    ]),
  ).filter((candidate) => candidate !== "");
}

function iconLookupCandidates(value: string): string[] {
  const mapped = getWaybarMappedAppId(value);
  return Array.from(
    new Set([
      ...iconSearchCandidates(value),
      ...(mapped ? iconSearchCandidates(mapped) : []),
    ]),
  ).filter((candidate) => candidate !== "");
}

function desktopApplicationCandidates(window: IconWindowInfo): string[] {
  const classCandidates = [window.class, window.initialClass].filter(
    (candidate): candidate is string => Boolean(candidate && candidate !== ""),
  );
  const candidates = classCandidates.flatMap((candidate) => {
    const mapped = getWaybarMappedAppId(candidate);
    return mapped ? [candidate, mapped] : [candidate];
  });
  if (classCandidates.some(isGenericWrapperClass)) {
    candidates.push(
      ...buildTitleCandidates(window.title ?? ""),
      ...buildTitleCandidates(window.initialTitle ?? ""),
    );
  }

  return Array.from(
    new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)),
  );
}

function normalizeDesktopApplicationIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\.desktop$/, "");
}

function isLaunchableDesktopApplication(
  appInfo: GioUnix.DesktopAppInfo | null,
): appInfo is GioUnix.DesktopAppInfo {
  if (!appInfo || appInfo.get_is_hidden()) return false;
  return Boolean(
    appInfo.get_executable() || appInfo.get_boolean("DBusActivatable"),
  );
}

function findDesktopApplication(
  window: IconWindowInfo,
): DesktopApplicationMatch | null {
  const candidates = desktopApplicationCandidates(window);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    try {
      const desktopId = candidate.endsWith(".desktop")
        ? candidate
        : `${candidate}.desktop`;
      const appInfo = GioUnix.DesktopAppInfo.new(desktopId);
      if (isLaunchableDesktopApplication(appInfo)) {
        return { appInfo, desktopId: appInfo.get_id() ?? desktopId };
      }
    } catch {
      // Try matching against the installed application catalog.
    }
  }

  const normalizedCandidates = new Set(
    candidates.map(normalizeDesktopApplicationIdentity),
  );
  for (const entry of loadDesktopEntries()) {
    const identities = [entry.desktopId, entry.startupWmClass].filter(
      (identity): identity is string => Boolean(identity),
    );
    const matchesIdentity = identities.some((identity) =>
      normalizedCandidates.has(normalizeDesktopApplicationIdentity(identity)),
    );
    if (matchesIdentity) {
      return { appInfo: entry.appInfo, desktopId: entry.desktopId };
    }
  }

  for (const entry of loadDesktopEntries()) {
    if (
      normalizedCandidates.has(
        normalizeDesktopApplicationIdentity(entry.displayName),
      ) ||
      normalizedCandidates.has(
        normalizeDesktopApplicationIdentity(entry.executable),
      )
    ) {
      return { appInfo: entry.appInfo, desktopId: entry.desktopId };
    }
  }

  return null;
}

export function isGenericWrapperClass(appClass: string): boolean {
  if (!appClass) return false;
  const normalizedClass = appClass.toLowerCase();
  if (normalizedClass.startsWith("steam_app_")) return true;
  return genericWrapperClasses.some((wrapperClass) => normalizedClass === wrapperClass);
}

function getFaugusIconForCandidates(candidates: string[]): IconRef | null {
  const normalizedCandidates = candidates
    .flatMap((candidate) => {
      const mapped = getWaybarMappedAppId(candidate);
      return [
        candidate,
        ...buildTitleCandidates(candidate),
        ...(mapped ? [mapped, ...buildTitleCandidates(mapped)] : []),
      ];
    })
    .map(normalizeIconSearchTerm)
    .filter((candidate) => candidate !== "");
  if (normalizedCandidates.length === 0) return null;

  for (const game of loadFaugusGames()) {
    if (!game.icon || !fileExists(game.icon)) continue;
    const gameCandidates = [game.title ?? "", game.path ?? ""]
      .filter((candidate) => candidate !== "")
      .map(normalizeIconSearchTerm);

    if (
      gameCandidates.some((gameCandidate) =>
        normalizedCandidates.some(
          (candidate) => candidate.includes(gameCandidate) || gameCandidate.includes(candidate),
        ),
      )
    ) {
      return { kind: "file", path: game.icon };
    }
  }

  return null;
}

function getIconForClass(appClass: string, iconTheme?: Gtk.IconTheme | null): IconRef | null {
  if (!appClass) return null;
  const cachedIcon = iconCache.get(appClass);
  if (cachedIcon !== undefined) return cachedIcon;

  let icon: IconRef | null = null;

  icon = getIconFromDesktopFiles(appClass);
  if (icon) {
    iconCache.set(appClass, icon);
    return icon;
  }

  for (const candidate of iconLookupCandidates(appClass)) {
    icon = getSteamLibraryIconForCandidate(candidate);
    if (icon) {
      iconCache.set(appClass, icon);
      return icon;
    }
  }

  for (const desktopId of iconLookupCandidates(appClass).map((entry) => `${entry}.desktop`)) {
    try {
      const appInfo = GioUnix.DesktopAppInfo.new(desktopId);
      if (!appInfo) continue;
      icon = iconRefFromGioIcon(appInfo.get_icon());
      if (icon) break;
    } catch {
      // Try next desktop id.
    }
  }

  if (!icon) {
    for (const searchTerm of iconLookupCandidates(appClass)) {
      try {
        const desktopSearchResults = GioUnix.DesktopAppInfo.search(searchTerm);
        for (const desktopIds of desktopSearchResults) {
          for (const desktopId of desktopIds) {
            const appInfo = GioUnix.DesktopAppInfo.new(desktopId);
            if (!appInfo) continue;
            icon = iconRefFromGioIcon(appInfo.get_icon());
            if (icon) break;
          }
          if (icon) break;
        }
        if (icon) break;
      } catch {
        // Try next search term.
      }
    }
  }

  if (!icon && iconTheme) {
    for (const iconName of iconLookupCandidates(appClass)) {
      if (iconTheme.has_icon(iconName)) {
        icon = { kind: "theme", name: iconName };
        break;
      }
    }
  }

  iconCache.set(appClass, icon);
  return icon;
}

function getDirectIcon(iconName: string | undefined, iconTheme?: Gtk.IconTheme | null): IconRef | null {
  if (!iconName) return null;
  if (iconName.startsWith("/")) return fileExists(iconName) ? { kind: "file", path: iconName } : null;
  if (iconTheme?.has_icon(iconName)) return { kind: "theme", name: iconName };
  return null;
}

export function resolveAppIcon({ candidates, directIcon, iconTheme }: IconResolutionRequest): IconRef | null {
  const uniqueCandidates = Array.from(
    new Set(candidates.map((candidate) => candidate.trim()).filter((candidate) => candidate !== "")),
  );
  if (uniqueCandidates.length > 0) {
    const faugusIcon = getFaugusIconForCandidates(uniqueCandidates);
    if (faugusIcon) return faugusIcon;

    for (const candidate of uniqueCandidates) {
      const icon = getIconForClass(candidate, iconTheme);
      if (icon) return icon;
    }
  }

  return getDirectIcon(directIcon, iconTheme);
}

export function getIconForWindow(window: IconWindowInfo, iconTheme?: Gtk.IconTheme | null): IconRef | null {
  const classCandidates = [window.class, window.initialClass].filter(
    (candidate): candidate is string => Boolean(candidate && candidate !== ""),
  );

  const title = window.title ?? "";
  const initialTitle = window.initialTitle ?? "";
  const shouldTryTitleLookup =
    classCandidates.some(isGenericWrapperClass) ||
    title.toLowerCase().includes("(grabbed)") ||
    initialTitle.toLowerCase().includes("(grabbed)");

  const candidates = shouldTryTitleLookup
    ? [...classCandidates, ...buildTitleCandidates(title), ...buildTitleCandidates(initialTitle)]
    : classCandidates;

  const classIcon = resolveAppIcon({ candidates, iconTheme });
  if (classIcon) return classIcon;

  return resolveAppIcon({
    candidates: window.processExecutable ? [window.processExecutable] : [],
    iconTheme,
  });
}

export function resolveDesktopApplication(
  window: IconWindowInfo,
  iconTheme?: Gtk.IconTheme | null,
): ResolvedDesktopApplication | null {
  const application = findDesktopApplication(window);
  if (!application) return null;

  const { appInfo, desktopId } = application;

  return {
    desktopId,
    name: appInfo.get_display_name(),
    icon:
      getIconForWindow(window, iconTheme) ??
      iconRefFromGioIcon(appInfo.get_icon()),
  };
}

export function getFallbackLetter(window: IconWindowInfo): string {
  const primaryClass = window.class || window.initialClass || "";
  const title = window.title ?? "";
  const useTitleFallback =
    isGenericWrapperClass(primaryClass) ||
    title.toLowerCase().includes("(grabbed)") ||
    primaryClass === "";

  const fallbackSource = useTitleFallback ? title : primaryClass;
  const normalizedSource = fallbackSource.replace(/\s*\(grabbed\)\s*$/i, "").trim();
  if (!normalizedSource) return "?";

  const firstAlphanumeric = normalizedSource.match(/[a-z0-9]/i)?.[0];
  return firstAlphanumeric ? firstAlphanumeric.toUpperCase() : "?";
}
