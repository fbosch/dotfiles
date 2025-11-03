#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const glyphnames = require('../assets/glyphnames.json');

const ACRONYMS = new Set([
  "api", "aws", "css", "cpu", "db", "dev", "doc", "gpu", "html", "id", "ip", 
  "js", "nfc", "npm", "pdf", "sql", "ui", "url", "usb", "vm", "vpn", "xml",
]);

const TOKEN_SYNONYMS = {
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

const PACK_LABELS = {
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

function addSynonyms(token) {
  const synonyms = TOKEN_SYNONYMS[token] || [];
  const extras = [];

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

  return [...synonyms, ...extras].map(entry => entry.toLowerCase());
}

function splitNameIntoWords(value) {
  if (!value) return [];
  
  return value
    .split(/[_-]/g)
    .map(part => part.trim())
    .filter(Boolean);
}

function simpleTitleCase(word) {
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

function createIconDataURL(char, code) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><text x="128" y="180" font-family="JetBrainsMono Nerd Font Mono,Symbols Nerd Font Mono,monospace" font-size="160" text-anchor="middle" fill="white" font-weight="normal">${char}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function buildIconIndex() {
  const { METADATA, ...rawGlyphs } = glyphnames;
  
  // Build token dictionary for compression
  const tokenDictionary = new Set();
  const tempIndex = [];

  // First pass: collect all unique tokens
  Object.entries(rawGlyphs)
    .filter(([id]) => id !== "METADATA")
    .forEach(([id, glyph]) => {
      const [pack, ...rest] = id.split("-");
      const rawName = rest.join("-");
      const words = splitNameIntoWords(rawName);
      const packLabel = PACK_LABELS[pack] || pack.toUpperCase();
      const displayName = words.length > 0 
        ? words.map(w => simpleTitleCase(w)).join(" ") 
        : simpleTitleCase(pack);
      
      const searchTokens = new Set();
      searchTokens.add(id.toLowerCase());
      searchTokens.add(pack.toLowerCase());
      searchTokens.add(packLabel.toLowerCase());
      searchTokens.add(displayName.toLowerCase());
      searchTokens.add(rawName.toLowerCase().replace(/_/g, " "));
      
      words.forEach(word => {
        const normalized = word.toLowerCase();
        searchTokens.add(normalized);
        addSynonyms(normalized).forEach(s => searchTokens.add(s));
      });
      
      // Add to dictionary
      searchTokens.forEach(token => tokenDictionary.add(token));
      
      tempIndex.push({
        id,
        pack,
        char: glyph.char,
        code: glyph.code,
        displayName,
        packLabel,
        searchTokens: Array.from(searchTokens)
      });
    });

  // Convert dictionary to array for indexing
  const dictionary = Array.from(tokenDictionary);
  const tokenToIndex = new Map(dictionary.map((token, idx) => [token, idx]));
  
  console.log(`  Token dictionary size: ${dictionary.length} unique tokens`);
  
  // Second pass: replace tokens with indices
  const optimizedIndex = tempIndex.map(entry => ({
    ...entry,
    searchTokens: entry.searchTokens.map(token => tokenToIndex.get(token))
  }));

  return {
    dictionary,
    icons: optimizedIndex
  };
}

console.log('Building icon search index...');
const indexData = buildIconIndex();
console.log(`Generated index with ${indexData.icons.length} icons`);

const outputPath = path.join(__dirname, '../assets/icon-index.json');
fs.writeFileSync(outputPath, JSON.stringify(indexData));

const stats = fs.statSync(outputPath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`Index saved to ${outputPath} (${sizeMB} MB)`);
