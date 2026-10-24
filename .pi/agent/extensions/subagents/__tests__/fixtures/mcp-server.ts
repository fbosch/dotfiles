import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  let message: { id?: string | number; method?: string };
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (message.id === undefined) continue;
  const result =
    message.method === "initialize"
      ? {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "minimal-fixture", version: "1" },
        }
      : message.method === "tools/list"
        ? {
            tools: [
              {
                name: "lookup",
                description: "Fixture lookup",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: "MCP_FIXTURE_RESULT" }] }
          : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
}
