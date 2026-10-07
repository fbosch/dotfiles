import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuleSelector } from "./types";

const HEADER = 'local persistence = require("plugins.persistent_position")\nif not persistence.enabled then return end\n';

type Token = { value: string; kind: "word" | "symbol" | "string" | "number" };
type LuaScalar = string | boolean | number;
type LuaValue = LuaScalar | Map<string, LuaScalar>;

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < source.length) {
		if (/\s/.test(source[i])) {
			i++;
			continue;
		}
		const long = source.slice(i).match(/^\[(=*)\[/);
		if (source.startsWith("--", i)) {
			const comment = source.slice(i + 2).match(/^\[(=*)\[/);
			if (comment) {
				const end = source.indexOf(`]${comment[1]}]`, i + 2 + comment[0].length);
				if (end < 0) throw new Error("Unclosed Lua comment");
				i = end + comment[1].length + 2;
			} else {
				const end = source.indexOf("\n", i);
				i = end < 0 ? source.length : end + 1;
			}
			continue;
		}
		if (long) {
			const start = i + long[0].length;
			const end = source.indexOf(`]${long[1]}]`, start);
			if (end < 0) throw new Error("Unclosed Lua string");
			tokens.push({ kind: "string", value: source.slice(start, end).replace(/^\n/, "") });
			i = end + long[1].length + 2;
			continue;
		}
		if (source[i] === '"' || source[i] === "'") {
			const quote = source[i++];
			let value = "";
			let closed = false;
			while (i < source.length) {
				const char = source[i++];
				if (char === quote) { closed = true; break; }
				if (char === "\n") throw new Error("Unclosed Lua string");
				if (char !== "\\") { value += char; continue; }
				const escape = source[i++];
				const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'" };
				if (escape in escapes) value += escapes[escape];
				else if (escape && /[0-9]/.test(escape)) {
					const digits = escape + (source.slice(i).match(/^\d{0,2}/)?.[0] ?? "");
					i += digits.length - 1;
					const code = Number(digits);
					if (code > 255) throw new Error("Invalid Lua escape");
					value += String.fromCharCode(code);
				} else throw new Error("Unsupported Lua escape");
			}
			if (!closed) throw new Error("Unclosed Lua string");
			tokens.push({ kind: "string", value });
			continue;
		}
		const number = source.slice(i).match(/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/);
		if (number) {
			tokens.push({ kind: "number", value: number[0] });
			i += number[0].length;
			continue;
		}
		const word = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
		if (word) {
			tokens.push({ kind: "word", value: word[0] });
			i += word[0].length;
			continue;
		}
		if (".(){}[]=,;".includes(source[i])) {
			tokens.push({ kind: "symbol", value: source[i++] });
			continue;
		}
		throw new Error("Unsupported Lua syntax in persistence rules");
	}
	return tokens;
}

// shortcut: Accept only literal native declarations; add a full Lua parser if computed rules or handle assignments become supported.
function declarations(source: string): Map<string, LuaScalar>[] {
	const tokens = tokenize(source);
	let i = 0;
	const take = (value: string) => {
		if (tokens[i]?.value !== value || tokens[i]?.kind !== (/^[A-Za-z_]/.test(value) ? "word" : "symbol")) throw new Error(`Quickrule cannot read this persistence module: expected ${value}. Use guarded literal rules or edit it manually.`);
		i++;
	};
	const string = () => {
		const token = tokens[i++];
		if (token?.kind !== "string") throw new Error("Expected literal Lua string");
		return token.value;
	};
	const scalar = (): LuaScalar => {
		const token = tokens[i++];
		if (token?.kind === "string") return token.value;
		if (token?.kind === "word" && (token.value === "true" || token.value === "false")) return token.value === "true";
		if (token?.kind === "number" && Number.isFinite(Number(token.value))) return Number(token.value);
		throw new Error("Expected finite literal Lua scalar");
	};
	const table = (nested = false): Map<string, LuaValue> => {
		take("{");
		const result = new Map<string, LuaValue>();
		while (tokens[i]?.value !== "}") {
			if (i >= tokens.length) throw new Error("Unclosed Lua table");
			let key: string;
			if (tokens[i]?.value === "[") { i++; key = string(); take("]"); }
			else {
				const token = tokens[i++];
				if (token?.kind !== "word") throw new Error("Invalid Lua table key");
				key = token.value;
			}
			take("=");
			if (result.has(key)) throw new Error("Duplicate Lua table key");
			if (tokens[i]?.value === "{") {
				if (nested || key !== "match") throw new Error("Unsupported nested Lua table");
				const match = table(true);
				result.set(key, new Map([...match].map(([field, value]) => {
					if (value instanceof Map) throw new Error("Unsupported nested Lua table");
					return [field, value];
				})));
			} else result.set(key, scalar());
			if (tokens[i]?.value === "," || tokens[i]?.value === ";") i++;
			else if (tokens[i]?.value !== "}") throw new Error("Invalid Lua table separator");
		}
		take("}");
		return result;
	};
	for (const part of ["local", "persistence", "=", "require", "("]) take(part);
	if (string() !== "plugins.persistent_position") throw new Error("Unexpected persistence module");
	for (const part of [")", "if", "not", "persistence", ".", "enabled", "then", "return", "end"]) take(part);
	const rules: Map<string, LuaScalar>[] = [];
	while (i < tokens.length) {
		for (const part of ["hl", ".", "window_rule", "("]) take(part);
		const entry = table();
		take(")");
		if (tokens[i]?.value === ";") i++;
		const id = entry.get("persistent_position:remember");
		if (typeof id !== "string" || !id) throw new Error("Window rule lacks literal persistence ID");
		const match = entry.get("match");
		if (!(match instanceof Map) || match.size === 0) throw new Error("Window rule lacks native matcher");
		const rule = new Map<string, LuaScalar>();
		for (const [key, value] of entry) {
			if (value instanceof Map) {
				for (const [field, pattern] of value) rule.set(`match:${field}`, pattern);
			} else rule.set(key, value);
		}
		rules.push(rule);
	}
	return rules;
}

function luaString(value: string): string {
	return `"${value.replace(/[\\"\x00-\x1f\x7f]/g, (char) => {
		if (char === "\\" || char === '"') return `\\${char}`;
		return `\\${char.charCodeAt(0).toString().padStart(3, "0")}`;
	})}"`;
}

export function appendPersistenceRule(content: string | undefined, selector: RuleSelector, pattern: string): { content: string; added: boolean } {
	if (!["class", "initial_class", "title", "initial_title"].includes(selector) || typeof pattern !== "string") {
		throw new Error("Invalid persistence matcher");
	}
	const source = content ?? HEADER;
	const rules = declarations(source);
	if (rules.some((rule) => rule.get("enabled") !== false && rule.get(`match:${selector}`) === pattern)) return { content: source, added: false };
	let attempt = 0;
	let id: string;
	do {
		if (attempt > 1000) throw new Error("No available persistence ID");
		id = `quickrule-${createHash("sha256").update(JSON.stringify([selector, pattern, attempt])).digest("hex").slice(0, 24)}`;
		attempt++;
	} while (rules.some((rule) => rule.get("persistent_position:remember") === id));
	const line = `hl.window_rule({ match = { ${selector} = ${luaString(pattern)} }, ["persistent_position:remember"] = ${luaString(id)} })`;
	return { content: `${source}${source.endsWith("\n") ? "" : "\n"}${line}\n`, added: true };
}

export async function writePersistenceRule(selector: RuleSelector, pattern: string): Promise<boolean> {
	const path = join(homedir(), ".config/hypr/rules/persistent_position.lua");
	let content: string | undefined;
	try {
		content = await fs.readFile(path, "utf-8");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const updated = appendPersistenceRule(content, selector, pattern);
	if (updated.added) {
		await fs.mkdir(join(homedir(), ".config/hypr/rules"), { recursive: true });
		await fs.writeFile(path, updated.content, "utf-8");
	}
	return updated.added;
}
