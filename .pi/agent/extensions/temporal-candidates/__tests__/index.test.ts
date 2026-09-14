import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectTemporalCandidates,
  type FetchFunction,
  formatTemporalCandidates,
  listSharedTodoTasks,
  parseSharedTodoMcpResponse,
  readInboxReferences,
} from "../index";

const roots: string[] = [];

function sharedTodoResponse(state: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: state },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

async function createInbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "temporal-candidates-"));
  roots.push(root);
  await mkdir(join(root, "Inbox"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("collectTemporalCandidates", () => {
  test("filters checked tasks and exact Inbox frontmatter matches", async () => {
    const root = await createInbox();
    await writeFile(
      join(root, "Inbox", "by-id.md"),
      [
        "---",
        "shared_todo_id: formalized-id",
        'original_capture: "different text"',
        "---",
        "",
        "Formalized note",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, "Inbox", "by-text.md"),
      ["---", "original_capture: Capture by text", "---", ""].join("\n"),
    );
    await writeFile(
      join(root, "Inbox", "by-array.md"),
      ["---", "shared_todo_id: [array-id]", "---", ""].join("\n"),
    );

    const state = {
      revision: 7,
      tasks: [
        { id: "formalized-id", text: "Renamed task", checked: false },
        { id: "candidate-id", text: "Open idea", checked: false },
        { id: "checked-id", text: "Already done", checked: true },
        { id: "capture-id", text: "Capture by text", checked: false },
        { id: "array-id", text: "Array task", checked: false },
      ],
    };
    let requestUrl: string | URL | Request | undefined;
    let requestInit: RequestInit | undefined;
    const fetchFn: FetchFunction = async (input, init) => {
      requestUrl = input;
      requestInit = init;
      return sharedTodoResponse(state);
    };

    const details = await collectTemporalCandidates({
      cwd: root,
      mcpUrl: "http://todo.test/mcp",
      fetchFn,
      limit: 10,
    });

    expect(details).toEqual({
      revision: 7,
      inboxPath: "Inbox",
      inboxNotesScanned: 3,
      checkedTasksFiltered: 1,
      formalizedTasksFiltered: [
        {
          id: "formalized-id",
          text: "Renamed task",
          inboxNotes: ["Inbox/by-id.md"],
          matchedBy: ["shared_todo_id"],
        },
        {
          id: "capture-id",
          text: "Capture by text",
          inboxNotes: ["Inbox/by-text.md"],
          matchedBy: ["original_capture"],
        },
        {
          id: "array-id",
          text: "Array task",
          inboxNotes: ["Inbox/by-array.md"],
          matchedBy: ["shared_todo_id"],
        },
      ],
      totalCandidates: 1,
      offset: 0,
      limit: 10,
      candidates: [{ id: "candidate-id", text: "Open idea", checked: false }],
    });
    expect(requestUrl).toBe("http://todo.test/mcp");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    });
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    });
  });

  test("applies the candidate limit after filtering", async () => {
    const root = await createInbox();
    const fetchFn: FetchFunction = async () =>
      sharedTodoResponse({
        revision: 1,
        tasks: [
          { id: "one", text: "One", checked: false },
          { id: "two", text: "Two", checked: false },
        ],
      });

    const details = await collectTemporalCandidates({
      cwd: root,
      mcpUrl: "http://todo.test/mcp",
      fetchFn,
      limit: 1,
    });

    expect(details.candidates).toEqual([{ id: "one", text: "One", checked: false }]);
    expect(details.totalCandidates).toBe(2);
    expect(details.nextOffset).toBe(1);

    const nextPage = await collectTemporalCandidates({
      cwd: root,
      mcpUrl: "http://todo.test/mcp",
      fetchFn,
      limit: 1,
      offset: 1,
    });
    expect(nextPage.candidates).toEqual([{ id: "two", text: "Two", checked: false }]);
    expect(nextPage.nextOffset).toBeUndefined();
  });

  test("reads text-only MCP results", () => {
    expect(
      parseSharedTodoMcpResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ revision: 3, tasks: [] }),
            },
          ],
        },
      }),
    ).toEqual({ revision: 3, tasks: [] });
  });

  test("bounds chunked MCP responses before buffering", async () => {
    const fetchFn: FetchFunction = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1_000_001));
            controller.close();
          },
        }),
      );

    await expect(listSharedTodoTasks("http://todo.test/mcp", { fetchFn })).rejects.toThrow(
      "Shared todo MCP response is too large",
    );
  });

  test("fails when Inbox is absent instead of treating every task as new", async () => {
    const root = await mkdtemp(join(tmpdir(), "temporal-candidates-no-inbox-"));
    roots.push(root);

    await expect(readInboxReferences(root)).rejects.toThrow("Could not read Inbox directory");
  });
});

test("formats the filtering evidence and candidates", () => {
  expect(
    formatTemporalCandidates({
      revision: 4,
      inboxPath: "Inbox",
      inboxNotesScanned: 2,
      checkedTasksFiltered: 1,
      formalizedTasksFiltered: [],
      totalCandidates: 1,
      offset: 0,
      limit: 50,
      candidates: [{ id: "candidate", text: "A\nmultiline task", checked: false }],
    }),
  ).toBe(
    [
      "Shared todo revision: 4",
      "Inbox notes scanned: 2",
      "Filtered 1 checked task(s) and 0 task(s) already represented in Inbox frontmatter.",
      "",
      "Candidates (1 returned, 1 total; offset 0):",
      "- candidate: A multiline task",
    ].join("\n"),
  );
});
