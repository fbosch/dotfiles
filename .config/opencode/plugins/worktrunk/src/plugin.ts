import { type Plugin, tool } from "@opencode-ai/plugin";

const WORKING_MARKER = "🤖";
const WAITING_MARKER = "💬";

const WORKTRUNK_CHECK_CACHE_TTL_MS = 60_000;
const BRANCH_CACHE_TTL_MS = 1_000;
const STATUS_DEBOUNCE_MS = 200;
const BRANCH_POLL_INTERVAL_MS = 2_000;
const MARKER_MAX_LENGTH = 16;

const SAFE_BRANCH_PATTERN = /^[-A-Za-z0-9._/@]+$/;
const SAFE_REF_PATTERN = /^[-A-Za-z0-9._/@:+~^]+$/;

type Status = "working" | "thinking" | "waiting" | "idle";

const isStatus = (value: unknown): value is Status => {
  if (typeof value !== "string") {
    return false;
  }

  return ["working", "thinking", "waiting", "idle"].includes(value);
};

const isSafeBranchArg = (value: string) => SAFE_BRANCH_PATTERN.test(value);
const isSafeRefArg = (value: string) => SAFE_REF_PATTERN.test(value);

const isSafeMarker = (value: string) => {
  if (value.length > MARKER_MAX_LENGTH) {
    return false;
  }

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if ((codePoint >= 0 && codePoint <= 31) || codePoint === 127) {
      return false;
    }
  }

  return true;
};

const plugin: Plugin = async ({ client, $ }) => {
  let currentBranch: string | null = null;
  let lastKnownBranch: string | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  let worktrunkInstalledCache: boolean | null = null;
  let worktrunkCheckAt = 0;
  let branchCache: { branch: string | null; timestamp: number } | null = null;

  const isWorktrunkInstalled = async () => {
    const now = Date.now();
    if (
      worktrunkInstalledCache !== null &&
      now - worktrunkCheckAt < WORKTRUNK_CHECK_CACHE_TTL_MS
    ) {
      return worktrunkInstalledCache;
    }

    try {
      await $`wt --version`.quiet();
      worktrunkInstalledCache = true;
      worktrunkCheckAt = now;
      return true;
    } catch {
      worktrunkInstalledCache = false;
      worktrunkCheckAt = now;
      return false;
    }
  };

  const getCurrentBranch = async (forceRefresh = false) => {
    const now = Date.now();
    if (
      forceRefresh === false &&
      branchCache !== null &&
      now - branchCache.timestamp < BRANCH_CACHE_TTL_MS
    ) {
      return branchCache.branch;
    }

    try {
      const result = await $`git rev-parse --abbrev-ref HEAD`.quiet();
      const branch = result.stdout.toString().trim() || null;
      branchCache = { branch, timestamp: now };
      return branch;
    } catch {
      branchCache = { branch: null, timestamp: now };
      return null;
    }
  };

  const setStatusMarker = async (marker: string | null) => {
    if (currentBranch === null) {
      currentBranch = await getCurrentBranch();
      lastKnownBranch = currentBranch;
    } else {
      const current = await getCurrentBranch();
      if (current !== null && current !== currentBranch) {
        currentBranch = current;
        lastKnownBranch = current;
        branchCache = null;
      }
    }

    if (currentBranch === null) {
      return;
    }

    try {
      if (marker === null) {
        await $`wt config state marker set "" --branch ${currentBranch}`.quiet();
        return;
      }

      await $`wt config state marker set ${marker} --branch ${currentBranch}`.quiet();
    } catch (error) {
      await client.app.log({
        body: {
          service: "opencode-worktrunk",
          level: "debug",
          message: `Failed to set status marker: ${String(error)}`,
        },
      });
    }
  };

  const updateStatus = (marker: string | null) => {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
    }

    statusTimer = setTimeout(() => {
      setStatusMarker(marker).catch(() => {
        return;
      });
    }, STATUS_DEBOUNCE_MS);
  };

  const checkBranchChange = async () => {
    const refreshedBranch = await getCurrentBranch(true);
    if (refreshedBranch === null || refreshedBranch === lastKnownBranch) {
      return;
    }

    currentBranch = refreshedBranch;
    lastKnownBranch = refreshedBranch;
    branchCache = null;

    await client.app.log({
      body: {
        service: "opencode-worktrunk",
        level: "info",
        message: `Detected branch change: ${refreshedBranch}`,
      },
    });
  };

  setTimeout(() => {
    getCurrentBranch()
      .then((branch) => {
        currentBranch = branch;
        lastKnownBranch = branch;
      })
      .catch(() => {
        currentBranch = null;
        lastKnownBranch = null;
      });

    setInterval(() => {
      checkBranchChange().catch(() => {
        return;
      });
    }, BRANCH_POLL_INTERVAL_MS);
  }, 100);

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.status": {
          const status = (event as { status?: unknown }).status;
          if (isStatus(status) === false) {
            updateStatus(null);
            return;
          }

          if (status === "working" || status === "thinking") {
            updateStatus(WORKING_MARKER);
            return;
          }

          if (status === "waiting" || status === "idle") {
            updateStatus(WAITING_MARKER);
            return;
          }

          updateStatus(null);
          return;
        }

        case "session.created": {
          updateStatus(WAITING_MARKER);
          return;
        }

        case "session.idle":
        case "session.error": {
          updateStatus(null);
          return;
        }

        default:
          return;
      }
    },

    tool: {
      "worktrunk-list": tool({
        description: "List worktrees managed by Worktrunk.",
        args: {
          format: tool.schema
            .string()
            .optional()
            .describe("Output format: text (default) or json."),
          full: tool.schema
            .boolean()
            .optional()
            .describe("Include full details such as PR and CI state."),
          branches: tool.schema
            .boolean()
            .optional()
            .describe("Include branches without worktrees."),
        },
        async execute(args) {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          const listArgs = ["list"];

          if (args.format !== undefined) {
            if (args.format !== "text" && args.format !== "json") {
              return "Error: Invalid format. Use 'text' or 'json'.";
            }

            if (args.format === "json") {
              listArgs.push("--format=json");
            }
          }

          if (args.full) {
            listArgs.push("--full");
          }

          if (args.branches) {
            listArgs.push("--branches");
          }

          try {
            const result = await $`wt ${listArgs}`.quiet();
            return result.stdout.toString();
          } catch (error) {
            return `Error running wt list: ${String(error)}`;
          }
        },
      }),

      "worktrunk-switch": tool({
        description: "Switch to a Worktrunk branch/worktree.",
        args: {
          branch: tool.schema
            .string()
            .describe("Branch name, '@' for current branch, or '-' for previous."),
        },
        async execute(args) {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          const targetBranch = args.branch.trim();
          if (
            targetBranch !== "@" &&
            targetBranch !== "-" &&
            isSafeBranchArg(targetBranch) === false
          ) {
            return "Error: Invalid branch name.";
          }

          try {
            const result = await $`wt switch --yes -- ${targetBranch}`.quiet();
            currentBranch = await getCurrentBranch(true);
            lastKnownBranch = currentBranch;
            updateStatus(WAITING_MARKER);
            return result.stdout.toString() || `Switched to ${targetBranch}.`;
          } catch (error) {
            return `Error switching branch '${targetBranch}': ${String(error)}`;
          }
        },
      }),

      "worktrunk-status": tool({
        description: "Get Worktrunk status for the current branch.",
        args: {},
        async execute() {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          currentBranch = await getCurrentBranch(true);
          lastKnownBranch = currentBranch;

          if (currentBranch === null) {
            return "Not in a git repository or branch not detected.";
          }

          try {
            const result = await $`wt list --branch ${currentBranch}`.quiet();
            const output = result.stdout.toString().trim();
            return output.length > 0 ? output : `Current branch: ${currentBranch}`;
          } catch (error) {
            return `Error getting Worktrunk status: ${String(error)}`;
          }
        },
      }),

      "worktrunk-status-update": tool({
        description: "Set or clear Worktrunk marker for a branch.",
        args: {
          marker: tool.schema
            .string()
            .describe("Marker value. Use empty string to clear."),
          branch: tool.schema
            .string()
            .optional()
            .describe("Target branch. Defaults to current branch."),
        },
        async execute(args) {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          const markerValue = args.marker;
          if (isSafeMarker(markerValue) === false) {
            return `Error: Invalid marker. Max length is ${MARKER_MAX_LENGTH} and control characters are not allowed.`;
          }

          let targetBranch = args.branch?.trim();
          if (!targetBranch || targetBranch === "@") {
            targetBranch = await getCurrentBranch(true);
          }

          if (!targetBranch) {
            return "Not in a git repository or branch not detected.";
          }

          if (isSafeBranchArg(targetBranch) === false) {
            return "Error: Invalid branch name.";
          }

          try {
            await $`wt config state marker set ${markerValue} --branch ${targetBranch}`.quiet();
            currentBranch = targetBranch;
            lastKnownBranch = targetBranch;
            const rendered = markerValue.length === 0 ? "(cleared)" : markerValue;
            return `Updated marker for '${targetBranch}': ${rendered}`;
          } catch (error) {
            return `Error updating marker: ${String(error)}`;
          }
        },
      }),

      "worktrunk-create": tool({
        description: "Create a new Worktrunk branch/worktree and switch to it.",
        args: {
          branch: tool.schema
            .string()
            .describe("Branch name to create, or '@' for current branch."),
          base: tool.schema
            .string()
            .optional()
            .describe("Optional base branch/ref. Use '@' for current HEAD."),
          skipHooks: tool.schema
            .boolean()
            .optional()
            .describe("Skip git hooks with --no-verify."),
        },
        async execute(args) {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          const targetBranch = args.branch.trim();
          if (targetBranch !== "@" && isSafeBranchArg(targetBranch) === false) {
            return "Error: Invalid branch name.";
          }

          const baseRef = args.base?.trim();
          if (baseRef && baseRef !== "@" && isSafeRefArg(baseRef) === false) {
            return "Error: Invalid base ref.";
          }

          const createArgs = ["switch", "--create", "--yes"];
          if (args.skipHooks) {
            createArgs.push("--no-verify");
          }

          createArgs.push("--", targetBranch);
          if (baseRef) {
            createArgs.push(`--base=${baseRef}`);
          }

          try {
            const result = await $`wt ${createArgs}`.quiet();
            currentBranch = await getCurrentBranch(true);
            lastKnownBranch = currentBranch;
            updateStatus(WAITING_MARKER);
            return result.stdout.toString() || `Created and switched to ${targetBranch}.`;
          } catch (error) {
            return `Error creating branch '${targetBranch}': ${String(error)}`;
          }
        },
      }),

      "worktrunk-remove": tool({
        description: "Remove a Worktrunk branch/worktree.",
        args: {
          branch: tool.schema
            .string()
            .describe("Branch name to remove, or '@' for current worktree."),
        },
        async execute(args) {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          const targetBranch = args.branch.trim();
          if (targetBranch !== "@" && isSafeBranchArg(targetBranch) === false) {
            return "Error: Invalid branch name.";
          }

          try {
            const result = await $`wt remove --yes -- ${targetBranch}`.quiet();
            currentBranch = await getCurrentBranch(true);
            lastKnownBranch = currentBranch;
            return result.stdout.toString() || `Removed ${targetBranch}.`;
          } catch (error) {
            return `Error removing '${targetBranch}': ${String(error)}`;
          }
        },
      }),

      "worktrunk-default-branch": tool({
        description: "Get repository default branch from Worktrunk state.",
        args: {},
        async execute() {
          if ((await isWorktrunkInstalled()) === false) {
            return "Error: Worktrunk (wt) is not installed.";
          }

          try {
            const result = await $`wt config state default-branch`.quiet();
            const branch = result.stdout.toString().trim();
            if (branch.length === 0) {
              return "Unable to determine default branch.";
            }

            return branch;
          } catch (error) {
            return `Error getting default branch: ${String(error)}`;
          }
        },
      }),
    },
  };
};

export const WorktrunkPlugin = plugin;
