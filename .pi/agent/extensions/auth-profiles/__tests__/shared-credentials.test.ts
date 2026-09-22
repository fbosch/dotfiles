import { describe, expect, test } from "bun:test";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { createProfileCredentialStore } from "../index";

class MemoryCredentialStore implements CredentialStore {
  constructor(private readonly credentials = new Map<string, Credential>()) {}

  async read(providerId: string) {
    return this.credentials.get(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.credentials].map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    const next = await update(this.credentials.get(providerId));
    if (next !== undefined) this.credentials.set(providerId, next);
    return this.credentials.get(providerId);
  }

  async delete(providerId: string) {
    this.credentials.delete(providerId);
  }
}

const apiKey = (key: string): Credential => ({ type: "api_key", key });

describe("auth profile shared credentials", () => {
  test("keeps the selected account provider isolated while exposing shared providers", async () => {
    const selected = new MemoryCredentialStore(
      new Map([
        ["openai-codex", apiKey("selected-account")],
        ["selected-only", apiKey("selected")],
      ]),
    );
    const shared = new MemoryCredentialStore(
      new Map([
        ["openai-codex", apiKey("default-account")],
        ["vercel-ai-gateway", apiKey("gateway")],
      ]),
    );
    const store = createProfileCredentialStore(selected, shared, "openai-codex");

    expect(await store.read("openai-codex")).toEqual(apiKey("selected-account"));
    expect(await store.read("selected-only")).toEqual(apiKey("selected"));
    expect(await store.read("vercel-ai-gateway")).toEqual(apiKey("gateway"));
    expect((await store.list()).map(({ providerId }) => providerId).sort()).toEqual([
      "openai-codex",
      "selected-only",
      "vercel-ai-gateway",
    ]);
  });

  test("routes account writes to the profile and shared-provider writes to auth.json", async () => {
    const selected = new MemoryCredentialStore();
    const shared = new MemoryCredentialStore();
    const store = createProfileCredentialStore(selected, shared, "openai-codex");

    await store.modify("openai-codex", async () => apiKey("account"));
    await store.modify("vercel-ai-gateway", async () => apiKey("gateway"));

    expect(await selected.read("openai-codex")).toEqual(apiKey("account"));
    expect(await shared.read("openai-codex")).toBeUndefined();
    expect(await shared.read("vercel-ai-gateway")).toEqual(apiKey("gateway"));
    expect(await selected.read("vercel-ai-gateway")).toBeUndefined();
  });
});
