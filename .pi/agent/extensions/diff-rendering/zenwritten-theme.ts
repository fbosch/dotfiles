import type { ThemeRegistration } from "shiki";

const palette = {
  background: "#191919",
  text: "#BBBBBB",
  muted: "#686868",
  gray: "#8E8E8E",
  added: "#819B69",
  removed: "#DE6E7C",
  addedBackground: "#232D1A",
  removedBackground: "#3E2225",
} as const;

export const zenwrittenTheme = {
  name: "zenwritten_dark",
  type: "dark",
  fg: palette.text,
  bg: palette.background,
  colors: {
    "editor.background": palette.background,
    "editor.foreground": palette.text,
    "editorLineNumber.foreground": palette.muted,
    "editorLineNumber.activeForeground": palette.gray,
    "editor.selectionBackground": "#2C2C2C",
    "editorWhitespace.foreground": "#555555",
    "diffEditor.insertedTextBackground": palette.addedBackground,
    "diffEditor.removedTextBackground": palette.removedBackground,
    "gitDecoration.addedResourceForeground": palette.added,
    "gitDecoration.deletedResourceForeground": palette.removed,
  },
  settings: [
    { settings: { foreground: palette.text } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: palette.muted, fontStyle: "italic" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.operator"],
      settings: { foreground: palette.text, fontStyle: "bold" },
    },
    {
      scope: ["entity.name.function", "support.function", "variable.function"],
      settings: { foreground: palette.text },
    },
    {
      scope: ["string", "constant.other.symbol", "constant.other.key"],
      settings: { foreground: palette.gray },
    },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: palette.gray },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
      settings: { foreground: palette.gray },
    },
    { scope: "markup.inserted", settings: { foreground: palette.added } },
    { scope: "markup.deleted", settings: { foreground: palette.removed } },
  ],
} satisfies ThemeRegistration;
