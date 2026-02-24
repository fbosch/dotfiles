(function () {
  const CACHE_KEY = "glance.start.linkwarden.entries.v1";
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const SCORE_THRESHOLD = 0.56;
  const FALLBACK_SEARCH_URL = "https://kagi.com/search?q={QUERY}";
  const MAX_SUGGESTIONS = 8;
  const inputState = new WeakMap();

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

      entry.searchable = toSearchable(entry);
      entries.push(entry);
    }

    return entries;
  }

  function readCache() {
    return readCacheWithMode(false);
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

      return parsed.entries;
    } catch (_error) {
      return [];
    }
  }

  function writeCache(entries) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          entries,
        })
      );
    } catch (_error) {
      // Ignore cache write failures.
    }
  }

  function getEntries() {
    let entries = parseEntriesFromDom();

    if (entries.length > 0) {
      writeCache(entries);
      return entries;
    }

    entries = readCache();
    if (entries.length > 0) {
      return entries;
    }

    entries = readStaleCache();
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
    if (window.fuzzysort && typeof window.fuzzysort.go === "function") {
      const results = window.fuzzysort.go(query, entries, {
        keys: ["title", "url", "collection", "description", "tags"],
        limit: MAX_SUGGESTIONS,
      });

      return results.map(function (result) {
        return {
          entry: result.obj,
          score: result.score,
        };
      });
    }

    return fallbackMatches(query, entries);
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

    const dropdown = document.createElement("ul");
    dropdown.className = "start-linkwarden-dropdown";
    dropdown.hidden = true;
    dropdown.setAttribute("role", "listbox");
    searchContainer.appendChild(dropdown);

    const state = {
      dropdown,
      matches: [],
      selectedIndex: 0,
    };

    inputState.set(input, state);
    return state;
  }

  function hostnameFromUrl(value) {
    try {
      return new URL(value).hostname;
    } catch (_error) {
      return value;
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

    return "https://twenty-icons.com/" + encodeURIComponent(hostname);
  }

  function hideDropdown(state) {
    state.matches = [];
    state.selectedIndex = 0;
    state.dropdown.hidden = true;
    state.dropdown.innerHTML = "";
  }

  function renderDropdown(input, state) {
    const items = [];

    for (let index = 0; index < state.matches.length; index += 1) {
      const isSelected = index === state.selectedIndex;
      const match = state.matches[index];
      const title = match.entry.title || match.entry.url;
      const host = hostnameFromUrl(match.entry.url);
      const icon = faviconUrl(host);

      items.push(
        '<li class="start-linkwarden-dropdown-item' +
          (isSelected ? " is-selected" : "") +
          '" data-match-index="' +
          index +
          '" role="option" aria-selected="' +
          (isSelected ? "true" : "false") +
          '">' +
          '<span class="start-linkwarden-dropdown-main">' +
          '<img class="start-linkwarden-dropdown-icon" src="' +
          escapeHtml(icon) +
          '" alt="" loading="lazy" decoding="async" />' +
          '<span class="start-linkwarden-dropdown-title">' +
          escapeHtml(title) +
          "</span>" +
          "</span>" +
          '<span class="start-linkwarden-dropdown-host">' +
          escapeHtml(host) +
          "</span>" +
          "</li>"
      );
    }

    state.dropdown.innerHTML = items.join("");
    state.dropdown.hidden = state.matches.length === 0;

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

    const entries = getEntries();
    const matches = findMatches(query, entries);

    state.matches = matches;
    state.selectedIndex = 0;
    renderDropdown(input, state);
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

    if (state && state.matches.length > 0) {
      const selected = state.matches[state.selectedIndex] || state.matches[0];
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
        hideDropdown(state);
        openUrl(selected.entry.url, openInNewTab);
        return;
      }
    }

    if (isProbablyUrl(query)) {
      event.preventDefault();
      event.stopPropagation();
      openUrl(normalizeUrl(query), openInNewTab);
      return;
    }

    const matches = findMatches(query, getEntries());
    const best = matches[0];

    if (best && best.score >= SCORE_THRESHOLD) {
      event.preventDefault();
      event.stopPropagation();
      openUrl(best.entry.url, openInNewTab);
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
    if (next < 0) {
      state.selectedIndex = state.matches.length - 1;
    } else if (next >= state.matches.length) {
      state.selectedIndex = 0;
    } else {
      state.selectedIndex = next;
    }

    renderDropdown(input, state);
  }

  function initialize() {
    document.addEventListener(
      "input",
      function (event) {
        const target = event.target;
        if (isStartSearchInput(target) === false) {
          return;
        }

        updateSuggestions(target);
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

        if (event.key === "Escape") {
          const state = getOrCreateState(target);
          if (!state) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
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
  }

  if (document.readyState === "complete") {
    initialize();
  } else {
    window.addEventListener("load", initialize);
  }
})();
