import { PROJECT_REFERENCES_END, PROJECT_REFERENCES_START, type ProjectReference } from "./types";

export function formatProjectReferences(references: readonly ProjectReference[]): string {
  const entries = Object.fromEntries(
    references.map(({ name, path, description }) => [name, { path, description }]),
  );
  const serialized = JSON.stringify(entries)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return [
    "Project references provide additional directories that can be accessed when relevant.",
    PROJECT_REFERENCES_START,
    serialized,
    PROJECT_REFERENCES_END,
  ].join("\n");
}
