type Binding = {
  tool: string;
  scope: string;
  key: string;
  file: string;
  line: number;
  allowDuplicate: boolean;
};

const root = new URL("..", import.meta.url).pathname;
const bindings: Binding[] = [];
const unsupported: string[] = [];

function relative(path: string) {
  return path.slice(root.length + 1);
}

function add(tool: string, scope: string, key: string, file: string, line: number, allowDuplicate = false) {
  bindings.push({
    tool,
    scope,
    key: normalize(key, tool === "neovim"),
    file: relative(file),
    line,
    allowDuplicate,
  });
}

function normalize(key: string, preserveKeyCase = false) {
  const aliases: Record<string, string> = {
    CMD: "SUPER",
    COMMAND: "SUPER",
    CONTROL: "CTRL",
    ESC: "ESCAPE",
  };
  const expanded = key
    .replace(/<C-([^>]+)>/gi, "CTRL+$1")
    .replace(/<A-([^>]+)>/gi, "ALT+$1")
    .replace(/<S-([^>]+)>/gi, "SHIFT+$1")
    .replace(/<leader>/gi, "LEADER+")
    .replace(/<esc>/gi, "ESCAPE+")
    .replace(/<([a-z]+)>/gi, "$1");
  const parts = expanded
    .split(/[+|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (["CTRL", "ALT", "SHIFT", "SUPER"].includes(upper)) return upper;
      return aliases[upper] ?? (preserveKeyCase ? part : upper);
    });
  const modifiers = ["CTRL", "ALT", "SHIFT", "SUPER"].filter((modifier) => parts.includes(modifier));
  const keys = parts.filter((part) => !["CTRL", "ALT", "SHIFT", "SUPER"].includes(part));
  return [...modifiers, ...keys].join("+");
}

async function source(path: string) {
  return (await Bun.file(path).text()).split("\n");
}

async function extractHerdr() {
  const file = `${root}/.config/herdr/config.toml`;
  const lines = await source(file);
  let prefix = "CTRL+A";
  let command = false;

  for (const [index, line] of lines.entries()) {
    if (line === "[keys]") command = false;
    if (line === "[[keys.command]]") command = true;
    const match = line.match(/^\s*(?:key\s*=\s*)?"?([a-z_]+)"?\s*=\s*(.+)$/i);
    const commandKey = line.match(/^\s*key\s*=\s*"([^"]+)"/);
    if (command && commandKey) {
      add("herdr", "global", commandKey[1].replaceAll("prefix", prefix), file, index + 1);
      continue;
    }
    if (!match || command) continue;
    const [, name, value] = match;
    const keys = [...value.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
    if (name === "prefix" && keys[0]) {
      prefix = normalize(keys[0]);
      continue;
    }
    for (const key of keys) add("herdr", "global", key.replaceAll("prefix", prefix), file, index + 1);
  }
}

async function extractFish() {
  const file = `${root}/.config/fish/config.fish`;
  const lines = await source(file);
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*bind\s+(?:(?:-M|--mode)\s+(\S+)\s+)?(\\c.|ctrl-[a-z]|\S+)/i);
    if (!match) continue;
    const [, mode = "default", key] = match;
    const normalized = key.startsWith("\\c") ? `CTRL+${key.slice(2)}` : key;
    add("fish", mode, normalized, file, index + 1);
  }
}

function luaArguments(lines: string[], start: number) {
  let text = "";
  let depth = 0;
  for (let index = start; index < lines.length; index++) {
    text += `${lines[index]}\n`;
    depth += (lines[index].match(/\(/g) ?? []).length - (lines[index].match(/\)/g) ?? []).length;
    if (depth <= 0) return text;
  }
  return text;
}

async function extractHyprland() {
  const file = `${root}/.config/hypr/keybinds.lua`;
  const lines = await source(file);
  for (const [index, line] of lines.entries()) {
    if (!line.includes("bind.register(")) continue;
    const argumentsText = luaArguments(lines, index);
    const literal = argumentsText.match(/bind\.register\(\s*"([^"]+)"/s);
    const main = argumentsText.match(/bind\.register\(\s*main\("([^"]+)"\)/s);
    if (argumentsText.includes("workspace_key")) {
      const modifiers = argumentsText.includes('main("SHIFT + " .. workspace_key)') ? "SUPER+SHIFT" : "SUPER";
      for (const workspaceKey of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
        add("hyprland", "press", `${modifiers}+${workspaceKey}`, file, index + 1);
      }
      continue;
    }
    const key = literal?.[1] ?? (main ? `SUPER+${main[1]}` : undefined);
    if (!key) {
      unsupported.push(`${relative(file)}:${index + 1}: dynamic Hyprland binding`);
      continue;
    }
    const phase = /release\s*=\s*true/.test(argumentsText) ? "release" : "press";
    const allowDuplicate = lines.slice(Math.max(0, index - 10), index).some((entry) =>
      entry.includes("keybind-validator: allow-duplicate"),
    );
    add("hyprland", phase, key, file, index + 1, allowDuplicate);
  }
}

async function extractNeovim() {
  const directory = `${root}/.config/nvim/lua/config/keymaps`;
  for (const file of new Bun.Glob("**/*.lua").scanSync(directory)) {
    const path = `${directory}/${file}`;
    const lines = await source(path);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/\bmap\(\s*"([nvisxot]+)"\s*,\s*"([^"]+)"/);
      if (!match) continue;
      for (const mode of match[1]) add("neovim", mode, match[2], path, index + 1);
    }
  }
}

async function extractWezterm() {
  const file = `${root}/.config/wezterm/keys.lua`;
  const lines = await source(file);
  for (const [index, line] of lines.entries()) {
    const key = line.match(/^\s*key\s*=\s*"([^"]+)"/);
    if (!key) continue;
    const mods = lines.slice(index, index + 4).join("\n").match(/mods\s*=\s*"([^"]+)"/);
    if (!mods) {
      unsupported.push(`${relative(file)}:${index + 1}: WezTerm key without literal modifiers`);
      continue;
    }
    add("wezterm", "terminal", `${mods[1]}+${key[1]}`, file, index + 1);
  }
  for (const [index, line] of lines.entries()) {
    const call = line.match(/^\s*activate_tab_key\("([1-9])",\s*\d+\),/);
    if (call) add("wezterm", "terminal", `CTRL+SHIFT+TAB-${call[1]}`, file, index + 1);
  }
}

await Promise.all([extractHerdr(), extractFish(), extractHyprland(), extractNeovim(), extractWezterm()]);

const duplicates = new Map<string, Binding[]>();
for (const binding of bindings) {
  const identity = `${binding.tool}:${binding.scope}:${binding.key}`;
  duplicates.set(identity, [...(duplicates.get(identity) ?? []), binding]);
}

const conflicts = [...duplicates.values()].filter(
  (entries) => entries.length > 1 && !entries.every((entry) => entry.allowDuplicate),
);
console.log(`Validated ${bindings.length} bindings across ${new Set(bindings.map((binding) => binding.tool)).size} tools.`);
for (const conflict of conflicts) {
  const [first] = conflict;
  console.error(`\nerror: ${first.key} is bound multiple times in ${first.tool} (${first.scope})`);
  for (const binding of conflict) console.error(`  ${binding.file}:${binding.line}`);
}
for (const message of unsupported) console.warn(`warning: ${message}`);

if (conflicts.length > 0) process.exit(1);
