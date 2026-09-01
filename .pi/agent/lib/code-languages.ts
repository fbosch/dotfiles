export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  "c#": "csharp",
  "c++": "cpp",
  console: "shell",
  cs: "csharp",
  diff: "diff",
  docker: "dockerfile",
  golang: "go",
  js: "javascript",
  javascriptreact: "javascript",
  jsdoc: "javascript",
  jsx: "javascript",
  jsonc: "json",
  md: "markdown",
  markdown_inline: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  typescriptreact: "typescript",
  yml: "yaml",
  zsh: "bash",
};

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  astro: "Astro",
  bash: "Shell",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  fish: "Fish",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  json5: "JSON5",
  lua: "Lua",
  markdown: "Markdown",
  mdx: "MDX",
  nix: "Nix",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  toml: "TOML",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

export const LANGUAGE_ICONS: Readonly<Record<string, string>> & { readonly diff: string } = {
  astro: "",
  bash: "",
  c: "",
  cpp: "",
  csharp: "󰌛",
  css: "",
  diff: "",
  dockerfile: "󰡨",
  fish: "",
  go: "",
  html: "",
  java: "",
  javascript: "",
  json: "",
  lua: "",
  markdown: "",
  mdx: "",
  nix: "",
  php: "",
  python: "",
  ruby: "",
  rust: "",
  sql: "",
  toml: "",
  typescript: "",
  xml: "󰗀",
  yaml: "",
};

export const GENERIC_FILE_ICON = "󰈙";

export const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  astro: "astro",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  diff: "diff",
  fish: "fish",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  nix: "nix",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export function normaliseLanguage(value: string | undefined): string | undefined {
  const language = value?.trim().toLowerCase();
  if (!language || language === "text" || language === "plaintext" || language === "txt") {
    return undefined;
  }

  return LANGUAGE_ALIASES[language] ?? language;
}

export function languageFromPath(path: string | undefined): string | undefined {
  const fileName = path?.split(/[\\/]/).pop()?.toLowerCase();
  if (!fileName) return undefined;
  if (fileName === "dockerfile") return "dockerfile";

  const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  return extension ? EXTENSION_LANGUAGES[extension] : undefined;
}
