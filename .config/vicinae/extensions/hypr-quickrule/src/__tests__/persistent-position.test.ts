import { describe, expect, test } from "bun:test";
import { appendPersistenceRule } from "../persistent-position";

const header = 'local persistence = require("plugins.persistent_position")\nif not persistence.enabled then return end\n';
const nemo = 'hl.window_rule({ match = { class = [=[^nemo$]=], initial_title = [=[negative:^(File Operations|Preparing)$]=] }, ["persistent_position:remember"] = "nemo-main" })\n';

describe("native persistence declarations", () => {
	test("creates guarded file with escaped native pattern and bounded literal ID", () => {
		const pattern = '^a"\\\n\0]=]$';
		const result = appendPersistenceRule(undefined, "class", pattern);
		expect(result.content).toStartWith(header);
		expect(result.content).toContain('class = "^a\\"\\\\\\010\\000]=]$"');
		expect(result.content).toMatch(/\["persistent_position:remember"\] = "quickrule-[a-f0-9]{24}"/);
		expect(appendPersistenceRule(result.content, "class", pattern)).toEqual({ content: result.content, added: false });
	});

	test("distinct matcher/pattern pairs yield deterministic unique IDs without class text", () => {
		const first = appendPersistenceRule(undefined, "class", "^private-app$").content;
		const other = appendPersistenceRule(undefined, "title", "^private-app$").content;
		const changed = appendPersistenceRule(undefined, "class", "^other$").content;
		const id = (source: string) => source.match(/quickrule-[a-f0-9]{24}/)?.[0];
		expect(id(first)).toBe(id(appendPersistenceRule(undefined, "class", "^private-app$").content));
		expect(new Set([id(first), id(other), id(changed)]).size).toBe(3);
		expect(id(first)).not.toContain("private-app");
	});

	test("recognizes guarded multifield declarations and preserves all manual content", () => {
		const source = `${header}-- hand edited\n${nemo}-- keep this comment\n`;
		expect(appendPersistenceRule(source, "class", "^nemo$")).toEqual({ content: source, added: false });
		const updated = appendPersistenceRule(source, "initial_title", "^other$");
		expect(updated.added).toBe(true);
		expect(updated.content.startsWith(source)).toBe(true);
		expect(updated.content).toContain('initial_title = "^other$"');
	});

	test("quoted literals work and comments/strings cannot masquerade as declarations", () => {
		const source = `${header}-- hl.window_rule({ match = { class = "^ghost$" }, ["persistent_position:remember"] = "fake" })\n${nemo}`;
		expect(appendPersistenceRule(source, "class", "^ghost$").added).toBe(true);
		const quoted = `${header}hl.window_rule({ match = { class = '^real$' }, ['persistent_position:remember'] = 'manual' })\n`;
		expect(appendPersistenceRule(quoted, "class", "^real$").added).toBe(false);
	});

	test("accepts native typed match and option literals while preserving the original bytes", () => {
		const native = `hl.window_rule({ enabled = true, match = { class = "^typed$", float = true, workspace = 3 }, ["persistent_position:remember"] = "typed-main", ["persistent_position:per_monitor"] = false, ["persistent_position:restore_size"] = true, ["persistent_position:restore_position"] = false })\n`;
		const source = `${header}-- native typed settings\n${native}`;
		expect(appendPersistenceRule(source, "class", "^typed$")).toEqual({ content: source, added: false });
		const appended = appendPersistenceRule(source, "title", "^next$");
		expect(appended.added).toBe(true);
		expect(appended.content.startsWith(source)).toBe(true);
	});

	test("disabled declarations do not block appending even when they own the generated ID", () => {
		const first = appendPersistenceRule(undefined, "class", "^disabled$").content;
		const disabled = first.replace('match = { class', 'enabled = false, match = { class');
		const appended = appendPersistenceRule(disabled, "class", "^disabled$");
		expect(appended.added).toBe(true);
		expect(appended.content.startsWith(disabled)).toBe(true);
		const ids = [...appended.content.matchAll(/quickrule-[a-f0-9]{24}/g)].map((match) => match[0]);
		expect(new Set(ids).size).toBe(2);
		expect(appendPersistenceRule(appended.content, "class", "^disabled$").added).toBe(false);
	});

	test("rejects unchecked selector keys and non-string patterns before serialization", () => {
		expect(() => appendPersistenceRule(undefined, "class = \"x\" }, os.execute" as RuleSelector, "^x$")).toThrow("Invalid persistence matcher");
		expect(() => appendPersistenceRule(undefined, "class", 3 as unknown as string)).toThrow("Invalid persistence matcher");
	});

	test("rejects missing guard, malformed declarations and unknown active syntax", () => {
		for (const source of [
			"return {}",
			`${header}hl.window_rule({ match = { class = "^x$" }`,
			`${header}hl.window_rule({ match = { class = "^x$" } })`,
			`${header}os.execute("oops")`,
			`${header}--[[ unfinished`,
			`${header}hl.window_rule({ match = { class = "^x$", workspace = 1e999 }, ["persistent_position:remember"] = "x" })`,
			`${header}hl.window_rule({ match = { class = "^x$", float = workspace }, ["persistent_position:remember"] = "x" })`,
			`${header}local handle = hl.window_rule({ match = { class = "^x$" }, ["persistent_position:remember"] = "x" })`,
		]) expect(() => appendPersistenceRule(source, "class", "^x$")).toThrow();
	});
});
