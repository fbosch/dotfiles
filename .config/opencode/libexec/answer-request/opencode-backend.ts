import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2";
import { createOpenCodeFilePart } from "./attachment.js";
import type { AnswerBackend, AnswerBackendRequest, AnswerBackendResult } from "./backend.js";
import type { AnswerErrorCode } from "./protocol.js";

const execFileAsync = promisify(execFile);
const OPENCODE_VERSION = "1.18.18";
const EXTERNAL_BASE_URL = "http://127.0.0.1:4096";
const DESKTOP_POINTER_AGENT = "desktop-pointer";
const PREFLIGHT_TIMEOUT_MILLISECONDS = 2_000;
const CLEANUP_TIMEOUT_MILLISECONDS = 2_000;
const ANSWER_SYSTEM_PROMPT =
  "Answer the user's question using only the supplied text and image. Do not use tools, perform actions, or claim actions were performed.";

type Response = { data?: unknown; error?: unknown };
type Options = { signal?: AbortSignal };
type Preflight = { ok: true; tools: Record<string, false> } | { ok: false; code: "backend_unavailable" | "backend_policy_invalid" | "incompatible_version" | "cancelled" | "timeout" };
type PreparedBackend = { policy: Preflight; client?: OpenCodeClient; owned?: OwnedServer };

export type AnswerPreflightResult = { ready: true } | { ready: false; code: Extract<AnswerErrorCode, "backend_unavailable" | "backend_policy_invalid" | "incompatible_version" | "cancelled" | "timeout" | "cleanup_failed"> };

export interface OpenCodeClient {
  global: { health(options?: Options): Promise<Response> };
  app: { agents(input: { directory: string }, options?: Options): Promise<Response> };
  config: { get(input: { directory: string }, options?: Options): Promise<Response> };
  provider: { list(input: { directory: string }, options?: Options): Promise<Response> };
  tool: { ids(input: { directory: string }, options?: Options): Promise<Response> };
  session: {
    create(input: { directory: string }, options?: Options): Promise<Response>;
    prompt(input: { sessionID: string; directory: string; system: string; agent: string; tools: Record<string, false>; parts: unknown[] }, options?: Options): Promise<Response>;
    abort(input: { sessionID: string; directory: string }, options?: Options): Promise<Response>;
    delete(input: { sessionID: string; directory: string }, options?: Options): Promise<Response>;
  };
}

export interface OwnedServer {
  client: OpenCodeClient;
  close(): void | Promise<void>;
}

export interface OpenCodeBackendDependencies {
  createClient(baseUrl: string, directory: string): OpenCodeClient;
  createOwned(signal: AbortSignal): Promise<OwnedServer>;
  getCliVersion(signal: AbortSignal): Promise<string>;
}

export function createOpenCodeAnswerBackend(dependencies: OpenCodeBackendDependencies = defaultDependencies()): AnswerBackend {
  const directory = process.env.OPENCODE_CONFIG_DIR ?? `${homedir()}/.config/opencode`;
  return { execute: async (request) => {
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(), request.timeoutSeconds * 1_000);
    const signal = request.signal === undefined ? deadline.signal : AbortSignal.any([request.signal, deadline.signal]);
    let owned: OwnedServer | undefined;
    let session: { client: OpenCodeClient; id: string; active: boolean } | undefined;
    let result: AnswerBackendResult = { ok: false, code: "provider_failed" };

    try {
      const prepared = await prepareBackend(dependencies, directory, signal, request.signal, deadline.signal);
      owned = prepared.owned;
      const policy = prepared.policy;
      if (policy.ok === false) {
        result = policy;
      } else {
        const client = prepared.client;
        if (client === undefined) throw new Error("missing prepared client");
        const attachments = await request.loadAttachments();
        if (attachments.isErr()) {
          result = { ok: false, code: attachments.error.code };
        } else if (signal.aborted) {
          result = failureForSignal(request.signal, deadline.signal);
        } else {
          const created = client.session.create({ directory }, { signal });
          const response = await raceWithSignal(created.then(deleteIfAborted(client, directory, signal)), signal);
          const id = sessionID(response);
          if (id === null) {
            result = { ok: false, code: "provider_failed" };
          } else {
            session = { client, id, active: true };
            const prompted = await raceWithSignal(client.session.prompt({
              sessionID: id,
              directory,
              system: ANSWER_SYSTEM_PROMPT,
              agent: DESKTOP_POINTER_AGENT,
              tools: policy.tools,
              parts: [{ type: "text", text: request.prompt }, ...attachments.value.map(createOpenCodeFilePart)],
            }, { signal }), signal);
            session.active = false;
            const parts = finalAssistantParts(prompted);
            result = parts === null ? { ok: false, code: "provider_failed" } : { ok: true, parts };
          }
        }
      }
    } catch (error) {
      result = isAbort(error) ? failureForSignal(request.signal, deadline.signal) : { ok: false, code: "provider_failed" };
    } finally {
      clearTimeout(timeout);
      if (await cleanup(session, owned, directory)) result = { ok: false, code: "cleanup_failed" };
    }
    return result;
  } };
}

export async function runOpenCodePreflight(dependencies: OpenCodeBackendDependencies = defaultDependencies(), signal?: AbortSignal): Promise<AnswerPreflightResult> {
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), PREFLIGHT_TIMEOUT_MILLISECONDS * 3);
  const combined = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]);
  const directory = process.env.OPENCODE_CONFIG_DIR ?? `${homedir()}/.config/opencode`;
  let owned: OwnedServer | undefined;
  let result: AnswerPreflightResult = { ready: false, code: "backend_unavailable" };

  try {
    const prepared = await prepareBackend(dependencies, directory, combined, signal, deadline.signal);
    owned = prepared.owned;
    result = prepared.policy.ok ? { ready: true } : { ready: false, code: prepared.policy.code };
  } catch (error) {
    result = isAbort(error) || combined.aborted
      ? { ready: false, code: failureForSignal(signal, deadline.signal).code }
      : { ready: false, code: "backend_unavailable" };
  } finally {
    clearTimeout(timeout);
    if (await cleanup(undefined, owned, directory)) result = { ready: false, code: "cleanup_failed" };
  }
  return result;
}

async function prepareBackend(dependencies: OpenCodeBackendDependencies, directory: string, signal: AbortSignal, caller: AbortSignal | undefined, timeout: AbortSignal): Promise<PreparedBackend> {
  const cliVersion = await raceWithSignal(dependencies.getCliVersion(signal), signal);
  if (cliVersion !== OPENCODE_VERSION) return { policy: { ok: false, code: "incompatible_version" } };

  const external = dependencies.createClient(EXTERNAL_BASE_URL, directory);
  const externalPolicy = await verifyPreflight(external, directory, signal, caller, timeout);
  if (externalPolicy.ok || signal.aborted) return { policy: externalPolicy, client: external };

  const created = dependencies.createOwned(signal);
  const owned = closeOnce(await raceWithSignal(created.then(closeIfAborted(signal)), signal));
  const policy = await verifyPreflight(owned.client, directory, signal, caller, timeout);
  return { policy, client: owned.client, owned };
}

async function verifyPreflight(client: OpenCodeClient, directory: string, signal: AbortSignal, caller: AbortSignal | undefined, timeout: AbortSignal): Promise<Preflight> {
  try {
    const health = unwrap(await bounded(client.global.health({ signal }), PREFLIGHT_TIMEOUT_MILLISECONDS));
    if (isHealth(health) === false) return { ok: false, code: "backend_unavailable" };
    if (health.version !== OPENCODE_VERSION) return { ok: false, code: "incompatible_version" };
    if (signal.aborted) return failureForSignal(caller, timeout);
    const [agentsResponse, configResponse, providersResponse, idsResponse] = await Promise.all([
      bounded(client.app.agents({ directory }, { signal }), PREFLIGHT_TIMEOUT_MILLISECONDS),
      bounded(client.config.get({ directory }, { signal }), PREFLIGHT_TIMEOUT_MILLISECONDS),
      bounded(client.provider.list({ directory }, { signal }), PREFLIGHT_TIMEOUT_MILLISECONDS),
      bounded(client.tool.ids({ directory }, { signal }), PREFLIGHT_TIMEOUT_MILLISECONDS),
    ]);
    if (signal.aborted) return failureForSignal(caller, timeout);
    const agent = desktopPointerAgent(unwrap(agentsResponse));
    const tools = denyAllTools(unwrap(idsResponse));
    if (agent === null || tools === null || supportsImage(agent, unwrap(configResponse), unwrap(providersResponse)) === false) {
      return { ok: false, code: "backend_policy_invalid" };
    }
    return { ok: true, tools };
  } catch (error) {
    return isAbort(error) || signal.aborted ? failureForSignal(caller, timeout) : { ok: false, code: "backend_unavailable" };
  }
}

async function cleanup(session: { client: OpenCodeClient; id: string; active: boolean } | undefined, owned: OwnedServer | undefined, directory: string): Promise<boolean> {
  let failed = false;
  if (session?.active) failed = (await cleanupCall((signal) => session.client.session.abort({ sessionID: session.id, directory }, { signal })) || failed);
  if (session !== undefined) failed = (await cleanupCall((signal) => session.client.session.delete({ sessionID: session.id, directory }, { signal })) || failed);
  if (owned !== undefined) failed = (await cleanupCall(() => Promise.resolve(owned.close())) || failed);
  return failed;
}

async function cleanupCall(call: (signal: AbortSignal) => Promise<Response | void>): Promise<boolean> {
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), CLEANUP_TIMEOUT_MILLISECONDS);
  try {
    const response = await raceWithSignal(call(deadline.signal), deadline.signal);
    return response !== undefined && (response.error !== undefined || response.data === false);
  } catch {
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

function unwrap(response: Response): unknown {
  if (response.error !== undefined) throw new Error("SDK response error");
  return response.data;
}

function desktopPointerAgent(value: unknown): object | null {
  if (Array.isArray(value) === false) return null;
  const agent = value.find((candidate) => typeof candidate === "object" && candidate !== null && Reflect.get(candidate, "name") === DESKTOP_POINTER_AGENT);
  if (typeof agent !== "object" || agent === null) return null;
  const permission = Reflect.get(agent, "permission");
  const wildcardDenied = Array.isArray(permission) && permission.some((rule) => typeof rule === "object" && rule !== null && Reflect.get(rule, "permission") === "*" && Reflect.get(rule, "pattern") === "*" && Reflect.get(rule, "action") === "deny");
  return wildcardDenied ? agent : null;
}

function denyAllTools(value: unknown): Record<string, false> | null {
  if (Array.isArray(value) === false || value.some((id) => typeof id !== "string" || id.length === 0)) return null;
  return Object.fromEntries(value.map((id) => [id, false]));
}

function supportsImage(agent: object, config: unknown, providers: unknown): boolean {
  const configured = typeof Reflect.get(agent, "model") === "object" && Reflect.get(agent, "model") !== null ? Reflect.get(agent, "model") : config;
  const model = resolveModel(configured);
  if (model === null || typeof providers !== "object" || providers === null) return false;
  const all = Reflect.get(providers, "all");
  const connected = Reflect.get(providers, "connected");
  if (Array.isArray(all) === false || Array.isArray(connected) === false || connected.includes(model.providerID) === false) return false;
  const provider = all.find((candidate) => typeof candidate === "object" && candidate !== null && Reflect.get(candidate, "id") === model.providerID);
  if (typeof provider !== "object" || provider === null) return false;
  const models = Reflect.get(provider, "models");
  if (typeof models !== "object" || models === null) return false;
  const entry = Reflect.get(models, model.modelID);
  if (typeof entry !== "object" || entry === null || Reflect.get(entry, "status") !== "active") return false;
  const capabilities = Reflect.get(entry, "capabilities");
  return typeof capabilities === "object" && capabilities !== null && typeof Reflect.get(capabilities, "input") === "object" && Reflect.get(capabilities, "input") !== null && Reflect.get(Reflect.get(capabilities, "input") as object, "image") === true;
}

function resolveModel(value: unknown): { providerID: string; modelID: string } | null {
  if (typeof value === "object" && value !== null && typeof Reflect.get(value, "providerID") === "string" && typeof Reflect.get(value, "modelID") === "string") return { providerID: Reflect.get(value, "providerID") as string, modelID: Reflect.get(value, "modelID") as string };
  if (typeof value !== "object" || value === null || typeof Reflect.get(value, "model") !== "string") return null;
  const configured = Reflect.get(value, "model") as string;
  const separator = configured.indexOf("/");
  return separator > 0 && separator < configured.length - 1 ? { providerID: configured.slice(0, separator), modelID: configured.slice(separator + 1) } : null;
}

function isHealth(value: unknown): value is { healthy: true; version: string } {
  return typeof value === "object" && value !== null && Reflect.get(value, "healthy") === true && typeof Reflect.get(value, "version") === "string";
}

function sessionID(response: Response): string | null {
  const data = unwrap(response);
  return typeof data === "object" && data !== null && typeof Reflect.get(data, "id") === "string" ? Reflect.get(data, "id") as string : null;
}

function finalAssistantParts(response: Response): unknown[] | null {
  const data = unwrap(response);
  if (typeof data !== "object" || data === null) return null;
  const info = Reflect.get(data, "info");
  const parts = Reflect.get(data, "parts");
  if (typeof info !== "object" || info === null || Reflect.get(info, "role") !== "assistant" || Reflect.get(info, "error") !== undefined || typeof Reflect.get(info, "time") !== "object" || Reflect.get(info, "time") === null || typeof Reflect.get(Reflect.get(info, "time") as object, "completed") !== "number") return null;
  return Array.isArray(parts) ? parts : null;
}

function closeOnce(owned: OwnedServer): OwnedServer {
  let closed = false;
  return { ...owned, close: async () => { if (closed) return; closed = true; await owned.close(); } };
}

function closeIfAborted(signal: AbortSignal): (owned: OwnedServer) => Promise<OwnedServer> {
  return async (owned) => { if (signal.aborted) await cleanupCall(() => Promise.resolve(owned.close())); return owned; };
}

function deleteIfAborted(client: OpenCodeClient, directory: string, signal: AbortSignal): (response: Response) => Promise<Response> {
  return async (response) => { const id = sessionID(response); if (signal.aborted && id !== null) await client.session.delete({ sessionID: id, directory }); return response; };
}

function failureForSignal(caller: AbortSignal | undefined, timeout: AbortSignal): { ok: false; code: "cancelled" | "timeout" } {
  return { ok: false, code: caller?.aborted === true && timeout.aborted === false ? "cancelled" : "timeout" };
}

function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return await Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))]);
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deadline exceeded")), milliseconds); })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

function defaultDependencies(): OpenCodeBackendDependencies {
  return {
    createClient: (baseUrl, directory) => createOpencodeClient({ baseUrl, directory }) as unknown as OpenCodeClient,
    async createOwned(signal) {
      const owned = await createOpencode({ hostname: "127.0.0.1", port: 0, signal });
      return { client: owned.client as unknown as OpenCodeClient, close: owned.server.close };
    },
    async getCliVersion(signal) {
      const { stdout } = await execFileAsync("opencode", ["--version"], { signal });
      return stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? "";
    },
  };
}
