import { spawnSync } from "node:child_process";
import { z } from "zod";

const workspaceListSchema = z.object({
	result: z.object({
		workspaces: z.array(
			z.object({
				label: z.string(),
				number: z.number(),
				workspace_id: z.string(),
			}),
		),
	}),
});

const tabListSchema = z.object({
	result: z.object({
		tabs: z.array(
			z.object({
				label: z.string(),
				tab_id: z.string(),
			}),
		),
	}),
});

function run(command: string, args: string[]) {
	return spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
}

function titleFrom(args: string[]) {
	const separator = args.indexOf("--");
	return separator < 0 ? undefined : args[separator + 1];
}

function targetFromTitle(title: string) {
	const match =
		/^.+ (?:finished|needs attention|updated): (.+) · (\d+)(?: · (.+))?$/.exec(
			title,
		);
	if (!match) return undefined;

	return {
		workspaceLabel: match[1],
		workspaceNumber: Number(match[2]),
		tabLabel: match[3],
	};
}

function jsonFrom(command: string, args: string[]) {
	const result = run(command, args);
	if (result.status !== 0) return undefined;

	try {
		return JSON.parse(result.stdout);
	} catch {
		return undefined;
	}
}

const notifySend = process.env.HERDR_NOTIFY_SEND_REAL;
if (!notifySend) process.exit(127);

const args = process.argv.slice(2);
const title = titleFrom(args);
const target = title ? targetFromTitle(title) : undefined;
if (!target) {
	const result = run(notifySend, args);
	process.exit(result.status ?? 1);
}

const notification = run(notifySend, [
	"-A",
	"default=Focus Herdr",
	"-w",
	...args,
]);
if (notification.status !== 0 || notification.stdout.trim() !== "default")
	process.exit(0);

const workspaces = workspaceListSchema.safeParse(
	jsonFrom("herdr", ["workspace", "list"]),
);
if (!workspaces.success) process.exit(0);

const labeled = workspaces.data.result.workspaces.filter(
	(workspace) => workspace.label === target.workspaceLabel,
);
const workspace =
	labeled.length === 1
		? labeled[0]
		: workspaces.data.result.workspaces.find(
				(candidate) => candidate.number === target.workspaceNumber,
			);
if (!workspace) process.exit(0);

if (!target.tabLabel) {
	run("herdr", ["workspace", "focus", workspace.workspace_id]);
	process.exit(0);
}

const tabs = tabListSchema.safeParse(
	jsonFrom("herdr", ["tab", "list", "--workspace", workspace.workspace_id]),
);
if (!tabs.success) process.exit(0);

const matchingTabs = tabs.data.result.tabs.filter(
	(tab) => tab.label === target.tabLabel,
);
if (matchingTabs.length === 1)
	run("herdr", ["tab", "focus", matchingTabs[0].tab_id]);
