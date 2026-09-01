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
  jsx: "javascript",
  jsonc: "json",
  md: "markdown",
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
  bash: "Shell",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  json5: "JSON5",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

export const LANGUAGE_ICONS: Readonly<Record<string, string>> & { readonly diff: string } = {
  bash: "",
  c: "",
  cpp: "",
  csharp: "󰌛",
  css: "",
  diff: "",
  dockerfile: "󰡨",
  go: "",
  html: "",
  java: "",
  javascript: "",
  json: "",
  lua: "",
  markdown: "",
  php: "",
  python: "",
  ruby: "",
  rust: "",
  sql: "",
  typescript: "",
  xml: "󰗀",
  yaml: "",
};

export const GENERIC_FILE_ICON = "󰈙";

export const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
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
