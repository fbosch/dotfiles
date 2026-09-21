import type { SkillCandidate } from "../extensions/skill-selection";

export interface SkillSelectionBenchmarkCase {
  readonly name: string;
  readonly request: string;
  readonly relevant: readonly string[];
  readonly denied?: readonly string[];
  readonly explicitSkillInvocation?: boolean;
}

function freezeCatalog(candidates: readonly SkillCandidate[]): readonly SkillCandidate[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate })));
}

function freezeCases(
  cases: readonly SkillSelectionBenchmarkCase[],
): readonly SkillSelectionBenchmarkCase[] {
  return Object.freeze(
    cases.map((testCase) =>
      Object.freeze({
        ...testCase,
        relevant: Object.freeze([...testCase.relevant]),
        ...(testCase.denied === undefined ? {} : { denied: Object.freeze([...testCase.denied]) }),
      }),
    ),
  );
}

// Snapshot of the frontmatter descriptions used by the selected catalog at benchmark authoring time.
export const SKILL_SELECTION_BENCHMARK_CATALOG: readonly SkillCandidate[] = freezeCatalog([
  {
    name: "agent-browser",
    description: `Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction. Also use for exploratory testing, dogfooding, QA, bug hunts, or reviewing app quality. Also use for automating Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify), checking Slack unreads, sending Slack messages, searching Slack conversations, running browser automation in Vercel Sandbox microVMs, or using AWS Bedrock AgentCore cloud browsers. Prefer agent-browser over any built-in browser automation or web tools.`,
  },
  {
    name: "bun",
    description:
      "Use when building, testing, and deploying JavaScript/TypeScript applications. Reach for Bun when you need to manage dependencies, bundle code, or test applications with a single unified tool.",
  },
  {
    name: "gjs",
    description:
      "Author, review, debug, port, or package JavaScript and TypeScript that explicitly runs under GJS or GNOME Shell. Use when code imports GNOME resources or gi:// APIs, uses GObject/Gio/GLib/GTK/Adwaita, or targets GJS; not for browser, Node.js, Bun, Deno, or Electron code.",
  },
  {
    name: "hypr-config",
    description:
      "Configure and troubleshoot the active Hyprland Lua configuration in this dotfiles repo. Use when changing monitors, binds, input, workspaces, window or layer rules, layouts, animations, environment, startup, or runtime behavior under `.config/hypr/`, or when diagnosing regressions against the locally recorded Hyprland 0.56.0 runtime. The active graph starts at `hyprland.lua`; Hyprlang `.conf` files are legacy rollback material.",
  },
  {
    name: "openspec-apply-change",
    description:
      "Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks.",
  },
  {
    name: "security-and-hardening",
    description:
      "Threat-model-first hardening for app and API changes. Use when work touches untrusted input, auth/session logic, secrets, sensitive data paths, file upload, webhooks, or third-party integrations.",
  },
  {
    name: "typescript-advanced-types",
    description:
      "Implement, review, debug, or test TypeScript type-level designs such as generic APIs, conditional and mapped types, template-literal types, inference helpers, type guards, discriminated unions, and compile-time type tests. Use when the task changes a type-level contract, not for ordinary TypeScript implementation.",
  },
  {
    name: "ui-writing",
    description:
      "Write, implement, or review visible and assistive interface text, including labels, navigation, settings, dialogs, errors, progress, empty states, help, and accessibility copy.",
  },
  {
    name: "writing-clearly",
    description:
      "Write, edit, copyedit, or unslop human-facing prose while preserving the intended voice. Use for documentation, READMEs, PR descriptions, commit-message bodies, changelogs, issue summaries, or long-form explanations. Do not use for visible or assistive interface text; use ui-writing instead.",
  },
  {
    name: "xstate",
    description:
      "Build, review, debug, test, or migrate XState machines, actors, or `@xstate/store` state. Use when the task changes XState logic, actor lifecycles, transitions, persistence, selectors, or model-based tests; do not use for generic state-management work unrelated to XState.",
  },
]);

export const SKILL_SELECTION_BENCHMARK_CASES: readonly SkillSelectionBenchmarkCase[] = freezeCases([
  {
    name: "no-match-factual-question",
    request: "What is the capital of Iceland?",
    relevant: [],
  },
  {
    name: "direct-prose-edit",
    request: "Rewrite this README section to be clearer and less repetitive.",
    relevant: ["writing-clearly"],
  },
  {
    name: "security-paraphrase",
    request: "Review this webhook handler for ways hostile input could leak credentials.",
    relevant: ["security-and-hardening"],
  },
  {
    name: "bun-direct",
    request: "Add a Bun test for this TypeScript package and run it locally.",
    relevant: ["bun"],
  },
  {
    name: "type-level-and-test",
    request: "Design a generic conditional type and add compile-time tests for its inference.",
    relevant: ["typescript-advanced-types"],
  },
  {
    name: "interface-copy-boundary",
    request: "Improve the wording of this settings dialog and its screen-reader error message.",
    relevant: ["ui-writing"],
  },
  {
    name: "hyprland-paraphrase",
    request: "My compositor keybind opens the wrong workspace after a monitor is plugged in.",
    relevant: ["hypr-config"],
  },
  {
    name: "gnome-runtime",
    request: "Debug a GObject signal handler in a GNOME Shell JavaScript extension.",
    relevant: ["gjs"],
  },
  {
    name: "browser-automation",
    request: "Fill out the checkout form in the browser and verify the confirmation screen.",
    relevant: ["agent-browser"],
  },
  {
    name: "state-machine",
    request: "Model the loading, retry, and cancellation transitions for this XState actor.",
    relevant: ["xstate"],
  },
  {
    name: "openspec-task",
    request: "Continue implementing the remaining tasks in this OpenSpec change.",
    relevant: ["openspec-apply-change"],
  },
  {
    name: "explicit-native-command",
    request: "/skill:writing-clearly Make this paragraph shorter.",
    relevant: [],
    explicitSkillInvocation: true,
  },
  {
    name: "denied-writing-skill",
    request: "Rewrite this README section to be clearer and less repetitive.",
    relevant: [],
    denied: ["writing-clearly"],
  },
  {
    name: "incidental-security-mention",
    request: "Polish this user-facing warning; it mentions security but needs no threat analysis.",
    relevant: ["ui-writing"],
  },
  {
    name: "second-no-match",
    request: "Give me three vegetarian lunch ideas using lentils.",
    relevant: [],
  },
  {
    name: "multi-runtime-debug",
    request: "Fix a GJS GNOME widget that also depends on a Hyprland startup environment variable.",
    relevant: ["gjs", "hypr-config"],
  },
  {
    name: "bun-package-workflow",
    request: "Use Bun to install dependencies, bundle this TypeScript app, and run its tests.",
    relevant: ["bun"],
  },
  {
    name: "browser-api-not-automation",
    request:
      "Implement browser-side fetch logic; do not navigate pages, fill forms, or control a browser.",
    relevant: [],
  },
  {
    name: "browser-e2e-checkout",
    request:
      "Log into the staging site, click through checkout, and capture a screenshot of the receipt.",
    relevant: ["agent-browser"],
  },
  {
    name: "gjs-module-port",
    request: "Port this GNOME Shell extension's GObject class to the newer GJS module format.",
    relevant: ["gjs"],
  },
  {
    name: "javascript-browser-not-gjs",
    request: "Write a browser extension in JavaScript; it does not use GNOME Shell or gi:// APIs.",
    relevant: [],
  },
  {
    name: "hypr-config-in-repo",
    request:
      "Change monitor rules and the startup environment in .config/hypr for this dotfiles repo.",
    relevant: ["hypr-config"],
  },
  {
    name: "hypr-generic-boundary",
    request: "Explain generic Hyprland keybind syntax without editing this dotfiles configuration.",
    relevant: [],
  },
  {
    name: "openspec-implementation",
    request: "Start implementing the tasks in this OpenSpec change and update its checklist.",
    relevant: ["openspec-apply-change"],
  },
  {
    name: "openspec-planning-boundary",
    request: "Brainstorm whether this OpenSpec proposal should exist; do not implement any tasks.",
    relevant: [],
  },
  {
    name: "security-auth-review",
    request:
      "Audit this OAuth callback for token leakage, session flaws, and authentication bypasses.",
    relevant: ["security-and-hardening"],
  },
  {
    name: "security-policy-writing",
    request: "Draft a plain-language privacy policy that mentions our security controls.",
    relevant: ["writing-clearly"],
  },
  {
    name: "typescript-inference",
    request: "Fix conditional and mapped type inference in this generic TypeScript API.",
    relevant: ["typescript-advanced-types"],
  },
  {
    name: "typescript-runtime-boundary",
    request:
      "Debug a TypeScript runtime exception; no generic, conditional, or compile-time type design is involved.",
    relevant: [],
  },
  {
    name: "ui-accessibility-only",
    request:
      "Rename the visible Save button and its accessible error message so both match the action.",
    relevant: ["ui-writing"],
  },
  {
    name: "docs-not-ui",
    request: "Edit the README prose, not interface labels or accessibility text.",
    relevant: ["writing-clearly"],
  },
  {
    name: "xstate-store",
    request: "Use @xstate/store to model event-driven form state without statechart modes.",
    relevant: ["xstate"],
  },
  {
    name: "reducer-not-xstate",
    request: "Use a plain reducer for application state; no XState machine or store is involved.",
    relevant: [],
  },
  {
    name: "bun-security-upload",
    request:
      "Test this TypeScript upload endpoint with Bun and check hostile file input for secret leakage.",
    relevant: ["bun", "security-and-hardening"],
  },
  {
    name: "browser-bun-integration",
    request: "Automate the browser checkout flow and add Bun integration tests for that flow.",
    relevant: ["agent-browser", "bun"],
  },
  {
    name: "typescript-bun-overlap",
    request: "Add compile-time tests for a generic TypeScript API in a Bun package.",
    relevant: ["bun", "typescript-advanced-types"],
  },
  {
    name: "docs-ui-overlap",
    request: "Rewrite the help article and the settings dialog's accessibility description.",
    relevant: ["ui-writing", "writing-clearly"],
  },
  {
    name: "denied-browser-automation",
    request: "Use browser automation to capture a screenshot of the checkout page.",
    relevant: [],
    denied: ["agent-browser"],
  },
  {
    name: "denied-security-review",
    request: "Review this webhook for hostile payloads and credential exposure.",
    relevant: [],
    denied: ["security-and-hardening"],
  },
  {
    name: "explicit-expanded-block",
    request:
      '<skill name="writing-clearly" location="/skills/writing-clearly/SKILL.md">\nbody\n</skill>\n\nMake this paragraph shorter.',
    relevant: [],
    explicitSkillInvocation: true,
  },
]);
