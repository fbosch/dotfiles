import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CombinedAutocompleteProvider, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { AgentMentionCache, agentMentionInstruction, findAgentMentions, loadAgentMentions } from "../agent-mentions";
import { createPromptAutocompleteProvider } from "../../prompt-ui/autocomplete";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-manual-agent-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  for (const name of ["quick", "code_review"]) await writeFile(join(agentDir, "agents", `${name}.md`), `---\ndescription: ${name} specialist\ncolor: "#e5d784"\n---\nWork on the task.\n`);
  const cache = new AgentMentionCache(cwd, agentDir, true);
  cleanup.push(async () => cache.dispose());
  await cache.start();
  return { cwd, agentDir, cache };
}

function autocomplete(cache: AgentMentionCache) {
  const native = new CombinedAutocompleteProvider([], cache.cwd, null);
  const files: AutocompleteProvider = {
    getSuggestions: async () => null,
    applyCompletion: (...args) => native.applyCompletion(...args),
  };
  return createPromptAutocompleteProvider(files, cache.getMentions().filter((mention) => !cache.isPathShadowed(mention.name)), [], (_mention, text) => text);
}

test("prompt suggestions and invocation share the installed specialist catalog", async () => {
  const { cwd, agentDir, cache } = await fixture();
  expect(loadAgentMentions(cwd, agentDir)).toEqual([...cache.getMentions()]);
  const provider = autocomplete(cache);
  expect(provider.triggerCharacters).toContain("@");
  const suggestions = await provider.getSuggestions(["@"], 0, 1, { signal: new AbortController().signal });
  expect(suggestions?.items.map((item) => item.value)).toEqual(["@code_review", "@quick"]);
});

test.each([["@qu", "quick"], ["@code_", "code_review"], ["@QU", "quick"]])("completing %s produces an exact routable specialist", async (prefix, name) => {
  const { cwd, cache } = await fixture();
  const provider = autocomplete(cache);
  const line = `Ask ${prefix}`;
  const suggestions = await provider.getSuggestions([line], 0, line.length, { signal: new AbortController().signal });
  const item = suggestions?.items.find((item) => item.value === `@${name}`);
  expect(item).toBeDefined();
  const completed = provider.applyCompletion([line], 0, line.length, item!, suggestions!.prefix);
  const mentions = findAgentMentions(completed.lines.join("\n") + "inspect this", cache.getMentions(), cwd);
  expect(mentions.map((mention) => mention.name)).toEqual([name]);
  expect(agentMentionInstruction(mentions)).toContain(`The user explicitly invoked @${name}.`);
  expect(item?.description).toBe(`Agent · ${name} specialist`);
});

test("project disabling and file shadowing affect both suggestions and invocation", async () => {
  const { cwd, cache } = await fixture();
  await writeFile(join(cwd, ".pi", "agents", "quick.md"), '---\nenabled: "false"\n---\nDisabled.\n');
  await writeFile(join(cwd, "code_review"), "file reference");
  await cache.refresh();
  const suggestions = await autocomplete(cache).getSuggestions(["@"], 0, 1, { signal: new AbortController().signal });
  expect(suggestions).toBeNull();
  expect(findAgentMentions("@quick @code_review", cache.getMentions(), cwd)).toEqual([]);
});

test("the repository quick specialist is available in prompt suggestions and routing", async () => {
  const { cwd } = await fixture();
  const cache = new AgentMentionCache(cwd, resolve(import.meta.dir, "../../.."), false);
  cleanup.push(async () => cache.dispose());
  await cache.start();
  const suggestions = await autocomplete(cache).getSuggestions(["@qu"], 0, 3, { signal: new AbortController().signal });
  expect(suggestions?.items.map((item) => item.value)).toEqual(["@quick"]);
  expect(findAgentMentions("@quick inspect this", cache.getMentions(), cwd).map((mention) => mention.name)).toEqual(["quick"]);
});
