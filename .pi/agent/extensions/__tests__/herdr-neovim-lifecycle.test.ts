import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface HerdrRequest {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface EnvironmentSnapshot {
  readonly HERDR_ENV: string | null;
  readonly HERDR_PANE_ID: string | null;
  readonly HERDR_SOCKET_PATH: string | null;
  readonly PI_NVIM_HERDR_PANE_ID: string | null;
  readonly PI_NVIM_SOCKET: string | null;
}

interface LifecycleSummary {
  readonly lifecycleSources: readonly unknown[];
  readonly metadataGuards: readonly unknown[];
  readonly metadataSources: readonly unknown[];
  readonly paneIds: readonly unknown[];
  readonly releases: number;
  readonly sessionPaths: readonly unknown[];
  readonly states: readonly unknown[];
  readonly titles: readonly unknown[];
}

const runnerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "herdr-lifecycle-runner.ts",
);

function summarize(requests: readonly HerdrRequest[]): LifecycleSummary {
  const lifecycle = requests.filter(({ method }) =>
    ["pane.release_agent", "pane.report_agent", "pane.report_agent_session"].includes(method),
  );
  const metadata = requests.filter(({ method }) => method === "pane.report_metadata");
  return {
    lifecycleSources: lifecycle.map(({ params }) => params.source),
    metadataGuards: metadata.map(({ params }) => params.applies_to_source),
    metadataSources: metadata.map(({ params }) => params.source),
    paneIds: requests.map(({ params }) => params.pane_id),
    releases: lifecycle.filter(({ method }) => method === "pane.release_agent").length,
    sessionPaths: lifecycle
      .filter(({ method }) => method === "pane.report_agent_session")
      .map(({ params }) => params.agent_session_path),
    states: lifecycle
      .filter(({ method }) => method === "pane.report_agent")
      .map(({ params }) => params.state),
    titles: metadata.map(({ params }) => {
      const tokens = params.tokens as Record<string, unknown> | undefined;
      return tokens?.pi_session_title;
    }),
  };
}

test("direct and Neovim-launched Pi use one exclusive Herdr reporter path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-herdr-neovim-"));
  const socketPath = join(directory, "herdr.sock");
  const requests: HerdrRequest[] = [];
  const server = net.createServer((socket) => {
    let input = "";
    socket.on("data", (data) => {
      input += data.toString();
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      requests.push(JSON.parse(input.slice(0, newline)) as HerdrRequest);
      socket.end("{}\n");
    });
  });

  async function runScenario(piNvimSocket?: string): Promise<{
    environment: EnvironmentSnapshot;
    requests: readonly HerdrRequest[];
  }> {
    const requestOffset = requests.length;
    const environment = { ...process.env };
    delete environment.PI_NVIM_HERDR_PANE_ID;
    delete environment.PI_NVIM_SOCKET;
    Object.assign(environment, {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "wFixture:p1",
      HERDR_SOCKET_PATH: socketPath,
    });
    if (piNvimSocket !== undefined) {
      delete environment.HERDR_PANE_ID;
      environment.PI_NVIM_HERDR_PANE_ID = "wFixture:p1";
      environment.PI_NVIM_SOCKET = piNvimSocket;
    }

    const child = Bun.spawn([process.execPath, runnerPath], {
      cwd: join(dirname(runnerPath), "../../.."),
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    return {
      environment: JSON.parse(stdout) as EnvironmentSnapshot,
      requests: requests.slice(requestOffset),
    };
  }

  try {
    await new Promise<void>((resolve, reject) =>
      server.listen(socketPath, resolve).once("error", reject),
    );
    const direct = await runScenario();
    const embedded = await runScenario("/tmp/nvim-fixture.sock");

    expect(direct.environment).toEqual({
      HERDR_ENV: "1",
      HERDR_PANE_ID: "wFixture:p1",
      HERDR_SOCKET_PATH: socketPath,
      PI_NVIM_HERDR_PANE_ID: null,
      PI_NVIM_SOCKET: null,
    });
    expect(embedded.environment).toEqual({
      ...direct.environment,
      HERDR_PANE_ID: null,
      PI_NVIM_HERDR_PANE_ID: "wFixture:p1",
      PI_NVIM_SOCKET: "/tmp/nvim-fixture.sock",
    });

    const directSummary = summarize(direct.requests);
    const embeddedSummary = summarize(embedded.requests);
    expect(embeddedSummary.states).toEqual(directSummary.states);
    expect(embeddedSummary.titles).toEqual(directSummary.titles);
    expect(directSummary.releases).toBe(0);
    expect(embeddedSummary.releases).toBe(1);
    expect(directSummary.paneIds).toEqual(
      Array.from({ length: direct.requests.length }, () => "wFixture:p1"),
    );
    expect(embeddedSummary.paneIds).toEqual(
      Array.from({ length: embedded.requests.length }, () => "wFixture:p1"),
    );
    expect(directSummary.lifecycleSources).toEqual(
      Array.from({ length: directSummary.lifecycleSources.length }, () => "herdr:pi"),
    );
    expect(embeddedSummary.lifecycleSources).toEqual(
      Array.from({ length: embeddedSummary.lifecycleSources.length }, () => "custom:neovim-pi"),
    );
    expect(directSummary.metadataSources).toEqual([
      "user:pi-session-title",
      "user:pi-session-title",
      "user:pi-session-title",
    ]);
    expect(embeddedSummary.metadataSources).toEqual(directSummary.metadataSources);
    expect(directSummary.metadataGuards).toEqual(["herdr:pi", "herdr:pi", "herdr:pi"]);
    expect(embeddedSummary.metadataGuards).toEqual([
      "custom:neovim-pi",
      "custom:neovim-pi",
      "custom:neovim-pi",
    ]);
    expect(directSummary.sessionPaths).toEqual([
      "/tmp/pi-herdr-fixture/session.jsonl",
      "/tmp/pi-herdr-fixture/session.jsonl",
    ]);
    expect(embeddedSummary.sessionPaths).toEqual([]);
    expect(directSummary.states).toEqual(["idle", "working", "blocked", "working", "idle"]);
    expect(directSummary.titles).toEqual(["Initial Pi session", "Renamed Pi session", null]);
    expect(
      embedded.requests.find(({ method }) => method === "pane.release_agent")?.params,
    ).toMatchObject({
      agent: "neovim-pi",
      pane_id: "wFixture:p1",
      source: "custom:neovim-pi",
      seq: expect.any(Number),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { force: true, recursive: true });
  }
});
