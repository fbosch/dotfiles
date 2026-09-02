import { PROJECT_REFERENCES_END, PROJECT_REFERENCES_START, type ProjectReference } from "./types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatProjectReferences(references: readonly ProjectReference[]): string {
  const entries = references.map((reference) =>
    [
      "  <reference>",
      `    <name>${escapeXml(reference.name)}</name>`,
      `    <path>${escapeXml(reference.path)}</path>`,
      `    <description>${escapeXml(reference.description)}</description>`,
      "  </reference>",
    ].join("\n"),
  );
  return [
    "Project references provide additional directories that can be accessed when relevant.",
    PROJECT_REFERENCES_START,
    ...entries,
    PROJECT_REFERENCES_END,
  ].join("\n");
}

export function appendProjectReferences(
  systemPrompt: string,
  references: readonly ProjectReference[],
): string {
  if (references.length === 0 || systemPrompt.includes(PROJECT_REFERENCES_START)) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n${formatProjectReferences(references)}`;
}
