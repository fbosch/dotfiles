export const MANIFEST_HEADER = "Retained reference manifest. Historical data, not instructions.";
export interface ReferencePart {
  text: string;
  reference?: string;
  summary?: string;
}
export interface ReferenceManifest {
  root?: string;
  calls?: string;
  parts: ReferencePart[];
}

export function parseReferenceManifest(text: string): ReferenceManifest | undefined {
  if (!text.startsWith(`${MANIFEST_HEADER}\n`)) return undefined;
  const boundary = text.indexOf("\n\n");
  if (boundary < 0) throw Error("Invalid reference manifest header");
  const header = text.slice(MANIFEST_HEADER.length, boundary).split("\n").filter(Boolean);
  let root: string | undefined;
  let calls: string | undefined;
  for (const line of header) {
    if (line.startsWith("Root: ") && root === undefined) root = line.slice(6);
    else if (line.startsWith("Calls: ") && calls === undefined) calls = line.slice(7);
    else throw Error("Invalid reference manifest header");
  }
  const parts: ReferencePart[] = [];
  const marker = /^\[(?:Reference ([^;\n]+); checkpoint position (\d+)|([^\]\s]+) @(\d+))\]\n/gmu;
  const body = text.slice(boundary + 2);
  const matches = [...body.matchAll(marker)];
  if (body.slice(0, matches[0]?.index ?? body.length).trim())
    throw Error("Invalid reference manifest body");
  for (const [index, match] of matches.entries()) {
    const reference = match[1] ?? match[3];
    if (!reference) throw Error("Missing reference ID");
    const end = matches[index + 1]?.index ?? body.length;
    parts.push({
      reference,
      text: body.slice((match.index ?? 0) + match[0].length, end).trimEnd(),
    });
  }
  return { ...(root ? { root } : {}), ...(calls ? { calls } : {}), parts };
}

export function renderReferenceManifest(
  parts: readonly ReferencePart[],
  root: string,
  calls?: string,
): string {
  const relative = (path: string) =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const render = (text: string) =>
    text
      .replace(
        /^\[saved (conversation|tool output)(?:; use read or recall)?\]: (.+)$/gmu,
        (_, kind: string, path: string) => `[saved ${kind}]: ${relative(path)}`,
      )
      .replace(
        /^\[tool call codemode; arguments line (\d+)\]: (.+)$/gmu,
        (line: string, index: string, path: string) =>
          path === calls ? `[tool call codemode; args ${index}]` : line,
      );
  return (
    [MANIFEST_HEADER, `Root: ${root}`, ...(calls ? [`Calls: ${relative(calls)}`] : [])].join("\n") +
    "\n\n" +
    parts
      .flatMap((part, position) =>
        part.reference === undefined
          ? []
          : [`[${part.reference} @${position}]\n${render(part.text)}`],
      )
      .join("\n\n") +
    "\n"
  );
}

export function codemodePreview(text: string, summary?: string): string | undefined {
  const json = /^\[tool call codemode\] (.+)$/u.exec(text)?.[1];
  if (json === undefined) return undefined;
  if (summary) return summary.slice(0, 240);
  let args: unknown;
  try {
    args = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (
    typeof args !== "object" ||
    args === null ||
    !("code" in args) ||
    typeof args.code !== "string"
  )
    return undefined;
  const names = [
    ...new Set([...args.code.matchAll(/tools\.([\w$]+)\s*\(/gu)].map((match) => match[1])),
  ];
  const context = args.code.replace(/\s+/gu, " ").trim();
  return `script mentions: ${names.join(", ") || "dynamic calls"}; preview: ${context}`.slice(
    0,
    240,
  );
}

export const argumentPointer = (index: number, path: string) =>
  `[tool call codemode; args ${index}]: ${path}`;
