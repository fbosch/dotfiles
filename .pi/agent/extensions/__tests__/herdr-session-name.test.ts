import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdrSessionName from "../herdr-session-name";

type Request = {
  method: string;
  params: {
    source: string;
    agent: string;
    applies_to_source: string;
    tokens: Record<string, string | null>;
  };
};

type Handler = (event?: { name?: string }, context?: { mode: string }) => Promise<void> | void;

test("reports Pi session names and clears them through lifecycle events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-session-name-"));
  const socketPath = join(directory, "herdr.sock");
  const requests: Request[] = [];
  const server = net.createServer((socket) => {
    socket.on("data", (data) => {
      requests.push(JSON.parse(data.toString()) as Request);
      socket.write("{}\n");
    });
  });
  const environment = {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID,
  };

  try {
    await new Promise<void>((resolve, reject) =>
      server.listen(socketPath, resolve).once("error", reject),
    );
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = socketPath;
    process.env.HERDR_PANE_ID = "wA:p1";

    const handlers: Record<string, Handler> = {};
    const pi = {
      getSessionName: () => "Initial session",
      on: (event: string, handler: Handler) => {
        handlers[event] = handler;
      },
    } as unknown as ExtensionAPI;

    herdrSessionName(pi);
    await handlers.session_start?.({}, { mode: "rpc" });
    await handlers.agent_start?.({}, { mode: "tui" });
    await handlers.session_info_changed?.({ name: "Renamed session" });
    await handlers.session_info_changed?.({});

    expect(requests.map(({ method }) => method)).toEqual([
      "pane.report_metadata",
      "pane.report_metadata",
      "pane.report_metadata",
    ]);
    expect(requests.map(({ params }) => params.tokens)).toEqual([
      { pi_session_title: "Initial session" },
      { pi_session_title: "Renamed session" },
      { pi_session_title: null },
    ]);
    expect(requests.every(({ params }) => params.source === "user:pi-session-title")).toBeTrue();
    expect(requests.every(({ params }) => params.agent === "pi")).toBeTrue();
    expect(requests.every(({ params }) => params.applies_to_source === "herdr:pi")).toBeTrue();
  } finally {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { force: true, recursive: true });
  }
});
