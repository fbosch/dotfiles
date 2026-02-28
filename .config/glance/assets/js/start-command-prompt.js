(function () {
  const CACHE_KEY = "glance.start.linkwarden.entries.v1";
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const INDEX_MEMORY_TTL_MS = 60 * 1000;
  const FAVICON_CACHE_KEY = "glance.start.favicon.sources.v1";
  const FAVICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FALLBACK_SEARCH_URL = "https://kagi.com/search?q={QUERY}";
  const MAX_SUGGESTIONS = 8;
  const SUGGESTION_DEBOUNCE_MS = 50;
  const AUTO_SELECT_MIN_QUERY = 3;
  const AUTO_SELECT_MIN_SCORE_POSITIVE = 0.35;
  const AUTO_SELECT_MIN_GAP_POSITIVE = 0.08;
  const AUTO_SELECT_MIN_SCORE = -1800;
  const AUTO_SELECT_MIN_GAP = 120;
  const CUSTOM_BANGS = {
    g: "https://www.google.com/search?q={{{s}}}",
    gh: "https://github.com/search?q={{{s}}}",
    yt: "https://www.youtube.com/results?search_query={{{s}}}",
    reddit: "https://www.reddit.com/search?q={{{s}}}",
    wikipedia: "https://wikipedia.org/w/index.php?search={{{s}}}",
    gmap: "https://maps.google.com/maps?q={{{s}}}",
    gma: "https://mail.google.com/mail/u/0/#search/{{{s}}}",
    imdb: "https://www.imdb.com/find?s=all&q={{{s}}}",
    ov: "https://stackoverflow.com/search?q={{{s}}}",
  };
  const BANG_ALIASES = {
    w: "wikipedia",
    rd: "reddit",
    so: "ov",
    maps: "gmap",
  };
  const inputState = new WeakMap();
  const faviconSourceCache = readFaviconSourceCache();
  const entryIndexState = {
    entries: [],
    signature: "",
    ts: 0,
  };
  let lastPersistedEntriesSignature = "";
  const ENTRY_INDEX_SELECTOR =
    "[data-start-linkwarden-json], [data-start-linkwarden-options], a[data-slot][href], a.size-h4.color-highlight[href]";

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  function normalizeSpaces(value) {
    return normalizeText(value).replace(/\s+/g, " ");
  }

  function toSearchable(entry) {
    return (
      entry.title +
      " " +
      entry.url +
      " " +
      entry.collection +
      " " +
      entry.description +
      " " +
      entry.tags
    ).toLowerCase();
  }

  function ensureSearchable(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const normalized = {
      title: normalizeSpaces(entry.title || ""),
      url: normalizeText(entry.url || ""),
      collection: normalizeSpaces(entry.collection || ""),
      description: normalizeSpaces(entry.description || ""),
      tags: normalizeSpaces(entry.tags || ""),
    };

    if (normalized.url === "") {
      return null;
    }

    normalized.searchable = toSearchable(normalized);
    return normalized;
  }

  function toCacheEntry(entry) {
    return {
      title: entry.title,
      url: entry.url,
      collection: entry.collection,
      description: entry.description,
      tags: entry.tags,
    };
  }

  function hydrateEntries(entries) {
    const hydrated = [];

    for (let index = 0; index < entries.length; index += 1) {
      const candidate = ensureSearchable(entries[index]);
      if (!candidate) {
        continue;
      }

      hydrated.push(candidate);
    }

    return hydrated;
  }

  function parseEntriesFromDom() {
    const nodes = document.querySelectorAll("[data-start-linkwarden-options] li");
    const entries = [];

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const url = normalizeText(node.getAttribute("data-url"));

      if (url === "") {
        continue;
      }

      const entry = {
        title: normalizeSpaces(node.getAttribute("data-title") || ""),
        url,
        collection: normalizeSpaces(node.getAttribute("data-collection") || ""),
        description: normalizeSpaces(node.getAttribute("data-description") || ""),
        tags: normalizeSpaces(node.getAttribute("data-tags") || ""),
      };

      const hydrated = ensureSearchable(entry);
      if (!hydrated) {
        continue;
      }

      entries.push(hydrated);
    }

    return entries;
  }

  function parseEntriesFromJson() {
    const node = document.querySelector("[data-start-linkwarden-json]");
    if (!node) {
      return [];
    }

    const raw = normalizeText(node.textContent || "");
    if (raw === "") {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const entries = [];

      for (let index = 0; index < parsed.length; index += 1) {
        const item = parsed[index];
        let title = "";
        let url = "";
        let collection = "";
        let description = "";
        let tags = "";

        if (Array.isArray(item)) {
          title = item[0] || "";
          url = item[1] || "";
          collection = item[2] || "";
          description = item[3] || "";
          tags = item[4] || "";
        } else if (item && typeof item === "object") {
          title = item.title || "";
          url = item.url || "";
          collection = item.collection || "";
          description = item.description || "";
          tags = item.tags || "";
        } else {
          continue;
        }

        url = normalizeText(url);
        if (url === "") {
          continue;
        }

        const hydrated = ensureSearchable({
          title,
          url,
          collection,
          description,
          tags,
        });

        if (!hydrated) {
          continue;
        }

        entries.push(hydrated);
      }

      return entries;
    } catch (_error) {
      return [];
    }
  }

  function parseSlotEntriesFromDom() {
    const nodes = document.querySelectorAll("a[data-slot][href]");
    const entries = [];

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const url = normalizeText(node.getAttribute("href"));

      if (url === "") {
        continue;
      }

      const entry = {
        title: normalizeSpaces(node.getAttribute("title") || ""),
        url,
        collection: "Pinned",
        description: "",
        tags: normalizeSpaces(node.getAttribute("data-slot") || ""),
      };

      if (entry.title === "") {
        entry.title = url.replace(/^https?:\/\/(www\.)?/i, "");
      }

      const hydrated = ensureSearchable(entry);
      if (!hydrated) {
        continue;
      }

      entries.push(hydrated);
    }

    return entries;
  }

  function parseQuicklinkEntriesFromDom() {
    const nodes = document.querySelectorAll("a.size-h4.color-highlight[href]");
    const entries = [];

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const url = normalizeText(node.getAttribute("href"));

      if (url === "") {
        continue;
      }

      const title = normalizeSpaces(node.getAttribute("title") || node.textContent || "");

      const entry = {
        title: title || url.replace(/^https?:\/\/(www\.)?/i, ""),
        url,
        collection: "Quicklinks",
        description: "",
        tags: "",
      };

      const hydrated = ensureSearchable(entry);
      if (!hydrated) {
        continue;
      }

      entries.push(hydrated);
    }

    return entries;
  }

  function mergeEntries(primaryEntries, secondaryEntries) {
    const byUrl = new Map();

    for (let index = 0; index < primaryEntries.length; index += 1) {
      const entry = primaryEntries[index];
      byUrl.set(entry.url, entry);
    }

    for (let index = 0; index < secondaryEntries.length; index += 1) {
      const entry = secondaryEntries[index];

      if (byUrl.has(entry.url)) {
        continue;
      }

      byUrl.set(entry.url, entry);
    }

    return Array.from(byUrl.values());
  }

  function getEntriesSignature(entries) {
    if (!entries || entries.length === 0) {
      return "0";
    }

    const first = entries[0] && entries[0].url ? entries[0].url : "";
    const lastIndex = entries.length - 1;
    const last = entries[lastIndex] && entries[lastIndex].url ? entries[lastIndex].url : "";

    return entries.length + "|" + first + "|" + last;
  }

  function canUseMemoryIndex() {
    if (entryIndexState.entries.length === 0) {
      return false;
    }

    if (Date.now() - entryIndexState.ts > INDEX_MEMORY_TTL_MS) {
      return false;
    }

    return true;
  }

  function invalidateEntryIndex() {
    entryIndexState.entries = [];
    entryIndexState.signature = "";
    entryIndexState.ts = 0;
  }

  function setMemoryIndex(entries) {
    entryIndexState.entries = entries;
    entryIndexState.signature = getEntriesSignature(entries);
    entryIndexState.ts = Date.now();
  }

  function nodeTouchesEntryIndex(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node.matches(ENTRY_INDEX_SELECTOR)) {
      return true;
    }

    return node.querySelector(ENTRY_INDEX_SELECTOR) !== null;
  }

  function mutationTouchesEntryIndex(mutation) {
    if (!(mutation.target instanceof Element)) {
      return false;
    }

    if (nodeTouchesEntryIndex(mutation.target)) {
      return true;
    }

    for (let index = 0; index < mutation.addedNodes.length; index += 1) {
      if (nodeTouchesEntryIndex(mutation.addedNodes[index])) {
        return true;
      }
    }

    for (let index = 0; index < mutation.removedNodes.length; index += 1) {
      if (nodeTouchesEntryIndex(mutation.removedNodes[index])) {
        return true;
      }
    }

    return false;
  }

  function observeEntryIndexSources() {
    if (typeof MutationObserver !== "function") {
      return;
    }

    const root = document.getElementById("page-content") || document.body;
    if (!root) {
      return;
    }

    const observer = new MutationObserver(function (mutations) {
      for (let index = 0; index < mutations.length; index += 1) {
        if (mutationTouchesEntryIndex(mutations[index])) {
          invalidateEntryIndex();
          return;
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function readCache() {
    return readCacheWithMode(false);
  }

  function readFaviconSourceCache() {
    try {
      const raw = localStorage.getItem(FAVICON_CACHE_KEY);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }

      const now = Date.now();
      const cache = {};
      const hosts = Object.keys(parsed);

      for (let index = 0; index < hosts.length; index += 1) {
        const host = hosts[index];
        const entry = parsed[host];

        if (!entry || typeof entry.src !== "string" || typeof entry.ts !== "number") {
          continue;
        }

        if (now - entry.ts > FAVICON_CACHE_TTL_MS) {
          continue;
        }

        cache[host] = entry;
      }

      return cache;
    } catch (_error) {
      return {};
    }
  }

  function writeFaviconSourceCache() {
    try {
      localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(faviconSourceCache));
    } catch (_error) {
      // Ignore cache write failures.
    }
  }

  function getCachedFaviconSource(hostname) {
    const host = normalizeText(hostname).toLowerCase();
    if (host === "") {
      return "";
    }

    const cached = faviconSourceCache[host];
    if (!cached || typeof cached.src !== "string" || typeof cached.ts !== "number") {
      return "";
    }

    if (Date.now() - cached.ts > FAVICON_CACHE_TTL_MS) {
      delete faviconSourceCache[host];
      writeFaviconSourceCache();
      return "";
    }

    return cached.src;
  }

  function setCachedFaviconSource(hostname, src) {
    const host = normalizeText(hostname).toLowerCase();
    const value = normalizeText(src);

    if (host === "" || value === "") {
      return;
    }

    faviconSourceCache[host] = {
      src: value,
      ts: Date.now(),
    };

    writeFaviconSourceCache();
  }

  function readStaleCache() {
    return readCacheWithMode(true);
  }

  function readCacheWithMode(allowStale) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.ts !== "number") {
        return [];
      }

      if (allowStale === false && Date.now() - parsed.ts > CACHE_TTL_MS) {
        return [];
      }

      return hydrateEntries(parsed.entries);
    } catch (_error) {
      return [];
    }
  }

  function writeCache(entries) {
    const signature = getEntriesSignature(entries);
    if (signature === lastPersistedEntriesSignature) {
      return;
    }

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          entries: entries.map(toCacheEntry),
        })
      );
      lastPersistedEntriesSignature = signature;
    } catch (_error) {
      // Ignore cache write failures.
    }
  }

  function getEntries() {
    if (canUseMemoryIndex()) {
      return entryIndexState.entries;
    }

    let entries = parseEntriesFromJson();
    if (entries.length === 0) {
      entries = parseEntriesFromDom();
    }

    const slotEntries = parseSlotEntriesFromDom();
    const quicklinkEntries = parseQuicklinkEntriesFromDom();

    if (slotEntries.length > 0) {
      entries = mergeEntries(entries, slotEntries);
    }

    if (quicklinkEntries.length > 0) {
      entries = mergeEntries(entries, quicklinkEntries);
    }

    if (entries.length > 0) {
      setMemoryIndex(entries);
      writeCache(entries);
      return entries;
    }

    entries = readCache();
    if (entries.length > 0) {
      setMemoryIndex(entries);
      return entries;
    }

    entries = readStaleCache();
    if (entries.length > 0) {
      setMemoryIndex(entries);
    }

    return entries;
  }

  function isProbablyUrl(query) {
    if (/^https?:\/\//i.test(query)) {
      return true;
    }

    if (/^(mailto:|tel:)/i.test(query)) {
      return true;
    }

    if (/\s/.test(query)) {
      return false;
    }

    return /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(
      query
    );
  }

  function normalizeUrl(query) {
    if (/^(mailto:|tel:)/i.test(query) || /^https?:\/\//i.test(query)) {
      return query;
    }

    return "https://" + query;
  }

  function buildSearchUrl(query) {
    return FALLBACK_SEARCH_URL.replace("{QUERY}", encodeURIComponent(query));
  }

  function parseBang(query) {
    const trimmed = normalizeSpaces(query);
    const match = trimmed.match(/^!([^\s]+)(?:\s+(.*))?$/);

    if (!match) {
      return null;
    }

    const key = normalizeText(match[1]).toLowerCase();
    const canonical = BANG_ALIASES[key] || key;
    const template = CUSTOM_BANGS[canonical];

    if (!template) {
      return null;
    }

    return {
      key: canonical,
      query: normalizeText(match[2] || ""),
      template,
    };
  }

  function buildBangUrl(bang) {
    return bang.template.replace("{{{s}}}", encodeURIComponent(bang.query));
  }

  function fallbackMatches(query, entries) {
    const lowered = query.toLowerCase();
    const matches = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.searchable.indexOf(lowered) === -1) {
        continue;
      }

      matches.push({
        entry,
        score: 1,
      });

      if (matches.length >= MAX_SUGGESTIONS) {
        break;
      }
    }

    return matches;
  }

  function findMatches(query, entries) {
    if (query.length < 2) {
      return {
        matches: fallbackMatches(query, entries),
        narrowedEntries: entries,
      };
    }

    const lowered = query.toLowerCase();
    const prefiltered = [];
    const broadMatchThreshold = Math.max(25, Math.floor(entries.length * 0.8));
    let isBroadMatch = false;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.searchable.indexOf(lowered) === -1) {
        continue;
      }

      prefiltered.push(entry);
      if (prefiltered.length >= 250) {
        break;
      }

      if (prefiltered.length >= broadMatchThreshold) {
        isBroadMatch = true;
        break;
      }
    }

    const matchSet =
      prefiltered.length > 0 && isBroadMatch === false && prefiltered.length < entries.length
        ? prefiltered
        : entries;

    if (window.fuzzysort && typeof window.fuzzysort.go === "function") {
      const results = window.fuzzysort.go(query, matchSet, {
        keys: ["title", "url", "collection", "description", "tags"],
        limit: MAX_SUGGESTIONS,
      });

      return {
        matches: results.map(function (result) {
          return {
            entry: result.obj,
            score: result.score,
          };
        }),
        narrowedEntries: matchSet,
      };
    }

    return {
      matches: fallbackMatches(query, matchSet),
      narrowedEntries: matchSet,
    };
  }

  function isStartSearchInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    if (input.classList.contains("search-input") === false) {
      return false;
    }

    return input.closest(".start-search") !== null;
  }

  function configureInputForManagers(input) {
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-bwignore", "true");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-lpignore", "true");
  }

  function getOrCreateState(input) {
    const existing = inputState.get(input);
    if (existing) {
      return existing;
    }

    const searchContainer = input.closest(".search");
    if (!searchContainer) {
      return null;
    }

    searchContainer.classList.add("start-search-with-suggestions");

    const backdrop = document.createElement("div");
    backdrop.className = "start-linkwarden-backdrop";
    backdrop.hidden = true;
    document.body.appendChild(backdrop);

    const dropdown = document.createElement("ul");
    dropdown.className = "start-linkwarden-dropdown";
    dropdown.hidden = true;
    dropdown.setAttribute("role", "listbox");
    searchContainer.appendChild(dropdown);

    const state = {
      backdrop,
      dropdown,
      matches: [],
      selectedIndex: -1,
      lastPrefetchedUrl: "",
      suggestionTimer: 0,
      lastQuery: "",
      lastFilteredEntries: [],
    };

    inputState.set(input, state);
    return state;
  }

  function hostnameFromUrl(value) {
    const raw = normalizeText(value).toLowerCase();
    if (raw === "") {
      return "";
    }

    try {
      return new URL(raw).hostname;
    } catch (_error) {
      const withoutProtocol = raw.replace(/^https?:\/\//, "");
      const firstSegment = withoutProtocol.split("/")[0] || "";
      const withoutPort = firstSegment.split(":")[0] || "";
      return withoutPort;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function faviconUrl(hostname) {
    if (!hostname) {
      return "";
    }

    return "https://twenty-icons.com/" + hostname + "/64";
  }

  function fallbackFaviconUrl(hostname) {
    if (!hostname) {
      return "";
    }

    return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(hostname) + "&sz=64";
  }

  function uniqueNonEmpty(values) {
    const seen = new Set();
    const output = [];

    for (let index = 0; index < values.length; index += 1) {
      const value = normalizeText(values[index]);
      if (value === "" || seen.has(value)) {
        continue;
      }

      seen.add(value);
      output.push(value);
    }

    return output;
  }

  function rootDomain(hostname) {
    if (!hostname || hostname.indexOf(".") === -1) {
      return hostname;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      return hostname;
    }

    const parts = hostname.split(".").filter(Boolean);
    if (parts.length < 2) {
      return hostname;
    }

    return parts.slice(-2).join(".");
  }

  function urlInfo(value) {
    const raw = normalizeText(value);
    if (raw === "") {
      return {
        hostname: "",
        origin: "",
      };
    }

    try {
      const parsed = new URL(raw);
      return {
        hostname: parsed.hostname.toLowerCase(),
        origin: parsed.origin,
      };
    } catch (_error) {
      const normalized = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;

      try {
        const parsed = new URL(normalized);
        return {
          hostname: parsed.hostname.toLowerCase(),
          origin: parsed.origin,
        };
      } catch (_secondError) {
        return {
          hostname: hostnameFromUrl(raw),
          origin: "",
        };
      }
    }
  }

  function isPrivateIp(hostname) {
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
      return false;
    }

    if (parts[0] === 10) {
      return true;
    }

    if (parts[0] === 127) {
      return true;
    }

    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }

    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }

    return false;
  }

  function isLocalServiceHost(hostname) {
    if (!hostname) {
      return false;
    }

    if (hostname === "localhost") {
      return true;
    }

    if (hostname.endsWith(".local")) {
      return true;
    }

    if (hostname.indexOf("corvus-corax") !== -1) {
      return true;
    }

    if (isPrivateIp(hostname)) {
      return true;
    }

    return false;
  }

  function localFaviconCandidates(host, origin) {
    const candidates = [];

    if (!origin) {
      return candidates;
    }

    if (host.indexOf("glance") !== -1) {
      candidates.push(origin + "/assets/icons/favicon.ico");
    }

    if (host.indexOf("wakapi") !== -1) {
      candidates.push(origin + "/assets/images/icon-192x192.png");
      candidates.push(origin + "/assets/images/icon-512x512.png");
      candidates.push(origin + "/assets/images/icon.svg");
    }

    if (host.indexOf("onwatch") !== -1) {
      candidates.push(origin + "/static/favicon.svg");
      candidates.push(origin + "/static/favicon-32x32.png");
      candidates.push(origin + "/static/favicon-16x16.png");
    }

    if (
      host.indexOf("lidarr") !== -1 ||
      host.indexOf("radarr") !== -1 ||
      host.indexOf("sonarr") !== -1 ||
      host.indexOf("prowlarr") !== -1 ||
      host.indexOf("readarr") !== -1 ||
      host.indexOf("bazarr") !== -1
    ) {
      candidates.push(origin + "/Content/Images/Icons/favicon-32x32.png");
      candidates.push(origin + "/Content/Images/Icons/favicon-16x16.png");
      candidates.push(origin + "/Content/Images/Icons/apple-touch-icon.png");
      candidates.push(origin + "/favicon.ico");
    }

    candidates.push(origin + "/static/favicon.svg");
    candidates.push(origin + "/static/favicon-32x32.png");
    candidates.push(origin + "/static/favicon-16x16.png");

    candidates.push(origin + "/favicon.ico");
    candidates.push(origin + "/favicon.png");
    candidates.push(origin + "/apple-touch-icon.png");
    candidates.push(origin + "/apple-touch-icon-precomposed.png");

    return uniqueNonEmpty(candidates);
  }

  function iconSourcesForUrl(url) {
    const info = urlInfo(url);
    const host = info.hostname;
    const baseDomain = rootDomain(host);

    if (isLocalServiceHost(host) && info.origin) {
      const locals = localFaviconCandidates(host, info.origin);

      return {
        host,
        icon: locals[0] || "",
        fallbackSources: uniqueNonEmpty(
          locals.slice(1).concat([faviconUrl(baseDomain), faviconUrl(host), fallbackFaviconUrl(host)])
        ),
      };
    }

    return {
      host,
      icon: faviconUrl(baseDomain),
      fallbackSources: uniqueNonEmpty([
        host !== baseDomain ? faviconUrl(host) : "",
        fallbackFaviconUrl(host),
      ]),
    };
  }

  function hideDropdown(state) {
    state.matches = [];
    state.selectedIndex = -1;
    state.lastPrefetchedUrl = "";
    state.lastQuery = "";
    state.lastFilteredEntries = [];

    if (state.suggestionTimer) {
      clearTimeout(state.suggestionTimer);
      state.suggestionTimer = 0;
    }

    state.backdrop.hidden = true;
    state.dropdown.hidden = true;
    state.dropdown.innerHTML = "";
  }

  function prefetchSelectedMatch(state) {
    if (!state || state.matches.length === 0) {
      return;
    }

    if (state.selectedIndex < 0) {
      return;
    }

    const selected = state.matches[state.selectedIndex] || state.matches[0];
    if (!selected || !selected.entry || !selected.entry.url) {
      return;
    }

    const url = selected.entry.url;
    if (state.lastPrefetchedUrl === url) {
      return;
    }

    state.lastPrefetchedUrl = url;

    if (!window.quicklink || typeof window.quicklink.prefetch !== "function") {
      return;
    }

    Promise.resolve(window.quicklink.prefetch(url)).catch(function () {
      // Ignore prefetch failures.
    });
  }

  function updateSelection(state) {
    const listItems = state.dropdown.querySelectorAll("[data-match-index]");

    for (let index = 0; index < listItems.length; index += 1) {
      const item = listItems[index];
      const isSelected = index === state.selectedIndex;

      item.classList.toggle("is-selected", isSelected);
      item.setAttribute("aria-selected", isSelected ? "true" : "false");
    }

    prefetchSelectedMatch(state);
  }

  function renderDropdown(input, state) {
    const items = [];

    for (let index = 0; index < state.matches.length; index += 1) {
      const isSelected = index === state.selectedIndex;
      const match = state.matches[index];
      const title = match.entry.title || match.entry.url;
      const iconSources = iconSourcesForUrl(match.entry.url);
      const host = iconSources.host;
      let icon = iconSources.icon;
      let fallbackSources = iconSources.fallbackSources || [];
      const cachedIcon = getCachedFaviconSource(host);

      if (cachedIcon) {
        fallbackSources = uniqueNonEmpty([icon].concat(fallbackSources));
        icon = cachedIcon;
      }

      const fallback = host ? host.charAt(0).toUpperCase() : "?";

      items.push(
        '<li class="start-linkwarden-dropdown-item' +
          (isSelected ? " is-selected" : "") +
          '" data-match-index="' +
          index +
          '" role="option" aria-selected="' +
          (isSelected ? "true" : "false") +
          '">' +
          '<span class="start-linkwarden-dropdown-main">' +
          '<span class="start-linkwarden-dropdown-icon-wrap" aria-hidden="true">' +
          '<span class="start-linkwarden-dropdown-icon-fallback">' +
          escapeHtml(fallback) +
          "</span>" +
          '<img class="start-linkwarden-dropdown-icon" src="' +
          escapeHtml(icon) +
          '" data-host="' +
          escapeHtml(host) +
          '" data-fallback-srcs="' +
          escapeHtml(fallbackSources.join("|")) +
          '" alt="" decoding="async" />' +
          "</span>" +
          '<span class="start-linkwarden-dropdown-title">' +
          escapeHtml(title) +
          "</span>" +
          "</span>" +
          '<span class="start-linkwarden-dropdown-host">' +
          escapeHtml(host) +
          '<kbd class="start-linkwarden-dropdown-enter">Enter</kbd>' +
          "</span>" +
          "</li>"
      );
    }

    state.dropdown.innerHTML = items.join("");
    state.dropdown.hidden = state.matches.length === 0;
    state.backdrop.hidden = state.matches.length === 0;

    if (state.matches.length === 0) {
      return;
    }

    const listItems = state.dropdown.querySelectorAll("[data-match-index]");

    for (let index = 0; index < listItems.length; index += 1) {
      const item = listItems[index];
      item.addEventListener("mousedown", function (event) {
        event.preventDefault();

        const raw = item.getAttribute("data-match-index");
        const selectedIndex = Number(raw);

        if (Number.isFinite(selectedIndex) === false) {
          return;
        }

        const selected = state.matches[selectedIndex];
        if (!selected) {
          return;
        }

        window.location.assign(selected.entry.url);
      });
    }

    const icons = state.dropdown.querySelectorAll(".start-linkwarden-dropdown-icon");
    for (let index = 0; index < icons.length; index += 1) {
      const icon = icons[index];
      const host = normalizeText(icon.getAttribute("data-host"));
      const fallbackAttr = icon.getAttribute("data-fallback-srcs") || "";
      const fallbackQueue = fallbackAttr
        .split("|")
        .map(function (value) {
          return normalizeText(value);
        })
        .filter(Boolean);

      icon.addEventListener("error", function () {
        const nextSrc = fallbackQueue.shift();

        if (nextSrc) {
          icon.src = nextSrc;
          return;
        }

        icon.remove();
      });

      icon.addEventListener("load", function () {
        const wrapper = icon.parentElement;
        if (wrapper) {
          wrapper.classList.add("has-icon");
        }

        if (host) {
          setCachedFaviconSource(host, icon.currentSrc || icon.src);
        }
      });
    }

    updateSelection(state);
  }

  function updateSuggestions(input) {
    const state = getOrCreateState(input);
    if (!state) {
      return;
    }

    const query = normalizeSpaces(input.value);
    if (query === "" || isProbablyUrl(query)) {
      hideDropdown(state);
      return;
    }

    if (parseBang(query)) {
      hideDropdown(state);
      return;
    }

    const entries = getEntries();
    let sourceEntries = entries;

    if (
      state.lastQuery &&
      query.indexOf(state.lastQuery) === 0 &&
      state.lastFilteredEntries.length > 0
    ) {
      sourceEntries = state.lastFilteredEntries;
    }

    let result = findMatches(query, sourceEntries);

    if (sourceEntries !== entries && result.matches.length === 0) {
      result = findMatches(query, entries);
      sourceEntries = entries;
    }

    state.matches = result.matches;
    state.selectedIndex = -1;
    state.lastQuery = query;
    state.lastFilteredEntries =
      result.narrowedEntries.length > 0 ? result.narrowedEntries : sourceEntries;
    renderDropdown(input, state);
  }

  function scheduleSuggestions(input) {
    const state = getOrCreateState(input);
    if (!state) {
      return;
    }

    if (state.suggestionTimer) {
      clearTimeout(state.suggestionTimer);
      state.suggestionTimer = 0;
    }

    const query = normalizeSpaces(input.value);
    if (query === "" || isProbablyUrl(query) || parseBang(query)) {
      hideDropdown(state);
      return;
    }

    state.suggestionTimer = window.setTimeout(function () {
      state.suggestionTimer = 0;
      updateSuggestions(input);
    }, SUGGESTION_DEBOUNCE_MS);
  }

  function flushSuggestions(input) {
    const state = getOrCreateState(input);
    if (!state || state.suggestionTimer === 0) {
      return;
    }

    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = 0;
    updateSuggestions(input);
  }

  function openUrl(url, openInNewTab) {
    if (openInNewTab === false) {
      window.location.assign(url);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function submitSearch(input, event) {
    const query = normalizeSpaces(input.value);
    if (query === "") {
      return;
    }

    const state = getOrCreateState(input);
    const openInNewTab = event.ctrlKey || event.metaKey;

    const bang = parseBang(query);
    if (bang) {
      event.preventDefault();
      event.stopPropagation();
      hideDropdown(state);
      openUrl(buildBangUrl(bang), openInNewTab);
      return;
    }

    if (state && state.matches.length > 0 && state.selectedIndex >= 0) {
      const selected = state.matches[state.selectedIndex] || state.matches[0];
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
        hideDropdown(state);
        openUrl(selected.entry.url, openInNewTab);
        return;
      }
    }

    if (state && state.matches.length > 0 && state.selectedIndex < 0) {
      const q = normalizeSpaces(query).toLowerCase();
      const top = state.matches[0];
      const second = state.matches[1] || null;
      const topScore = top && typeof top.score === "number" ? top.score : Number.NEGATIVE_INFINITY;
      const secondScore =
        second && typeof second.score === "number" ? second.score : Number.NEGATIVE_INFINITY;
      const title = (top && top.entry && top.entry.title ? top.entry.title : "").toLowerCase();
      const url = (top && top.entry && top.entry.url ? top.entry.url : "").toLowerCase();
      const containsQuery = title.indexOf(q) !== -1 || url.indexOf(q) !== -1;
      const usesFuzzyScores =
        window.fuzzysort &&
        typeof window.fuzzysort.go === "function" &&
        Number.isFinite(topScore);
      const usesPositiveScoreScale = topScore > 0;
      const isStrong = usesPositiveScoreScale
        ? topScore >= AUTO_SELECT_MIN_SCORE_POSITIVE
        : topScore >= AUTO_SELECT_MIN_SCORE;
      const hasGap = usesPositiveScoreScale
        ? Number.isFinite(secondScore) === false || topScore - secondScore >= AUTO_SELECT_MIN_GAP_POSITIVE
        : Number.isFinite(secondScore) === false || topScore - secondScore >= AUTO_SELECT_MIN_GAP;
      const queryWords = q.split(/\s+/).filter(Boolean);
      const titleStartsWithWord = queryWords.some(function (word) {
        return title.indexOf(word) === 0 || title.indexOf(" " + word) !== -1;
      });
      const closeTextMatch = containsQuery || titleStartsWithWord;

      if (
        q.length >= AUTO_SELECT_MIN_QUERY &&
        closeTextMatch &&
        usesFuzzyScores &&
        isStrong &&
        hasGap
      ) {
        event.preventDefault();
        event.stopPropagation();
        hideDropdown(state);
        openUrl(top.entry.url, openInNewTab);
        return;
      }
    }

    if (isProbablyUrl(query)) {
      event.preventDefault();
      event.stopPropagation();
      openUrl(normalizeUrl(query), openInNewTab);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openUrl(buildSearchUrl(query), openInNewTab);
  }

  function moveSelection(input, direction) {
    const state = getOrCreateState(input);
    if (!state || state.matches.length === 0) {
      return;
    }

    const next = state.selectedIndex + direction;
    if (state.selectedIndex < 0) {
      state.selectedIndex = direction > 0 ? 0 : state.matches.length - 1;
    } else if (next < 0) {
      state.selectedIndex = state.matches.length - 1;
    } else if (next >= state.matches.length) {
      state.selectedIndex = 0;
    } else {
      state.selectedIndex = next;
    }

    updateSelection(state);
  }

  function initialize() {
    observeEntryIndexSources();

    document.addEventListener(
      "input",
      function (event) {
        const target = event.target;
        if (isStartSearchInput(target) === false) {
          return;
        }

        configureInputForManagers(target);

        scheduleSuggestions(target);
      },
      true
    );

    document.addEventListener(
      "keydown",
      function (event) {
        const target = document.activeElement;
        if (isStartSearchInput(target) === false) {
          return;
        }

        configureInputForManagers(target);

        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
          flushSuggestions(target);
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          moveSelection(target, 1);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          moveSelection(target, -1);
          return;
        }

        if (event.ctrlKey && event.metaKey === false && event.altKey === false) {
          const loweredKey = event.key.toLowerCase();

          if (loweredKey === "j") {
            event.preventDefault();
            event.stopPropagation();
            moveSelection(target, 1);
            return;
          }

          if (loweredKey === "k") {
            event.preventDefault();
            event.stopPropagation();
            moveSelection(target, -1);
            return;
          }
        }

        if (event.key === "Escape") {
          const state = getOrCreateState(target);
          if (!state) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          if (state.selectedIndex >= 0) {
            state.selectedIndex = -1;
            state.lastPrefetchedUrl = "";
            updateSelection(state);
            return;
          }

          if (normalizeSpaces(target.value) !== "") {
            target.value = "";
          }

          hideDropdown(state);
          return;
        }

        if (event.key === "Enter") {
          submitSearch(target, event);
        }
      },
      true
    );

    document.addEventListener(
      "click",
      function (event) {
        const target = event.target;
        
        if (target instanceof Element && target.classList.contains("start-linkwarden-backdrop")) {
          const inputs = document.querySelectorAll(".start-search .search-input");
          for (let index = 0; index < inputs.length; index += 1) {
            const state = getOrCreateState(inputs[index]);
            if (!state) {
              continue;
            }

            hideDropdown(state);
          }
          return;
        }
        
        if (target instanceof Element && target.closest(".start-search") !== null) {
          return;
        }

        const inputs = document.querySelectorAll(".start-search .search-input");
        for (let index = 0; index < inputs.length; index += 1) {
          const state = getOrCreateState(inputs[index]);
          if (!state) {
            continue;
          }

          hideDropdown(state);
        }
      },
      true
    );

    document.addEventListener(
      "focusout",
      function (event) {
        const target = event.target;
        if (isStartSearchInput(target) === false) {
          return;
        }

        const state = getOrCreateState(target);
        if (!state) {
          return;
        }

        target.value = "";
        hideDropdown(state);
      },
      true
    );
  }

  if (document.readyState === "complete") {
    initialize();
  } else {
    window.addEventListener("load", initialize);
  }
})();
