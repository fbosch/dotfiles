import { createInterface } from "node:readline";

interface RpcRequest {
  id?: number | string;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function writeResponse(id: number | string, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as RpcRequest;
  if (request.id === undefined) continue;

  switch (request.method) {
    case "initialize": {
      const requestedVersion = isRecord(request.params)
        ? request.params.protocolVersion
        : undefined;
      writeResponse(request.id, {
        protocolVersion: typeof requestedVersion === "string" ? requestedVersion : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-local", version: "1.0.0" },
      });
      break;
    }
    case "tools/list":
      writeResponse(request.id, {
        tools: [
          {
            name: "fake_read",
            description: "A local integration-test tool; it is never called.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      });
      break;
    case "resources/list":
      writeResponse(request.id, { resources: [] });
      break;
    case "resources/templates/list":
      writeResponse(request.id, { resourceTemplates: [] });
      break;
    case "prompts/list":
      writeResponse(request.id, { prompts: [] });
      break;
    case "ping":
      writeResponse(request.id, {});
      break;
    default:
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Method not found" },
        })}\n`,
      );
  }
}
