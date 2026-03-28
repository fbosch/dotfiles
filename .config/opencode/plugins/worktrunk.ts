import { type Plugin, tool } from "@opencode-ai/plugin"

/**
 * OpenCode plugin for WorkTrunk integration
 * 
 * Tracks OpenCode session state and updates WorkTrunk status markers:
 * - 🤖 when Claude is working
 * - 💬 when Claude is waiting for input
 * 
 * Also provides custom tools for WorkTrunk operations.
 */
const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  let currentBranch: string | null = null
  let statusTimer: ReturnType<typeof setTimeout> | null = null
  let branchCheckInterval: ReturnType<typeof setInterval> | null = null
  let lastKnownBranch: string | null = null

  // Performance optimization: Cache WorkTrunk installation check
  let workTrunkInstalledCache: boolean | null = null
  let workTrunkCheckTime: number = 0
  const WORKTRUNK_CHECK_CACHE_TTL = 60000 // 1 minute cache

  // Check if WorkTrunk is installed (with caching)
  const isWorkTrunkInstalled = async (): Promise<boolean> => {
    const now = Date.now()
    // Use cached value if still valid
    if (workTrunkInstalledCache !== null && (now - workTrunkCheckTime) < WORKTRUNK_CHECK_CACHE_TTL) {
      return workTrunkInstalledCache
    }
    
    try {
      await $`wt --version`.quiet()
      workTrunkInstalledCache = true
      workTrunkCheckTime = now
      return true
    } catch {
      workTrunkInstalledCache = false
      workTrunkCheckTime = now
      return false
    }
  }

  // Performance optimization: Cache branch information
  let branchCache: { branch: string | null; timestamp: number } | null = null
  const BRANCH_CACHE_TTL = 1000 // 1 second cache for branch info

  // Detect current git branch (with caching)
  const getCurrentBranch = async (forceRefresh: boolean = false): Promise<string | null> => {
    const now = Date.now()
    
    // Use cached value if still valid and not forcing refresh
    if (!forceRefresh && branchCache && (now - branchCache.timestamp) < BRANCH_CACHE_TTL) {
      return branchCache.branch
    }
    
    try {
      const result = await $`git rev-parse --abbrev-ref HEAD`.quiet()
      const branch = result.stdout.toString().trim() || null
      branchCache = { branch, timestamp: now }
      return branch
    } catch {
      branchCache = { branch: null, timestamp: now }
      return null
    }
  }

  // Set WorkTrunk status marker
  const setStatusMarker = async (marker: string | null) => {
    // Use cached branch if available, but refresh if needed
    if (!currentBranch) {
      currentBranch = await getCurrentBranch()
      lastKnownBranch = currentBranch
    } else {
      // Quick check if branch changed (use cache for performance)
      const current = await getCurrentBranch()
      if (current !== currentBranch && current !== null) {
        currentBranch = current
        lastKnownBranch = current
        // Invalidate cache on branch change
        branchCache = null
      }
    }
    
    if (!currentBranch) {
      return // Not in a git repo or no branch detected
    }

    try {
      if (marker) {
        await $`wt config state marker set "${marker}" --branch ${currentBranch}`.quiet()
      } else {
        // Clear marker by setting empty
        await $`wt config state marker set "" --branch ${currentBranch}`.quiet()
      }
    } catch (error) {
      // WorkTrunk might not be installed or configured - that's okay
      await client.app.log({
        body: {
          service: "opencode-worktrunk",
          level: "debug",
          message: `Failed to set status marker: ${error}`,
        },
      })
    }
  }

  // Debounced status update with improved debouncing strategy
  const updateStatus = (marker: string | null) => {
    if (statusTimer) {
      clearTimeout(statusTimer)
    }
    // Use shorter debounce for status changes (200ms) to be more responsive
    // but still batch rapid status changes
    statusTimer = setTimeout(() => {
      setStatusMarker(marker)
    }, 200) // Debounce by 200ms for better responsiveness
  }

  // Check for branch changes that occur outside the plugin
  const checkBranchChange = async () => {
    // Force refresh to detect external changes
    const newBranch = await getCurrentBranch(true)
    if (newBranch !== lastKnownBranch && newBranch !== null) {
      // Branch changed externally - update tracking and invalidate cache
      currentBranch = newBranch
      lastKnownBranch = newBranch
      branchCache = null // Invalidate cache on branch change
      await client.app.log({
        body: {
          service: "opencode-worktrunk",
          level: "info",
          message: `Detected branch change: ${newBranch}`,
        },
      })
    }
  }

  // Initialize lazily - don't block startup with git/wt commands
  // Branch detection will happen on first status update
  
  // Use setImmediate to defer initialization after plugin loads
  setTimeout(async () => {
    try {
      currentBranch = await getCurrentBranch()
      lastKnownBranch = currentBranch

      // Set up periodic branch checking to detect external changes
      // Check every 2 seconds for branch changes (e.g., manual git checkout)
      if (currentBranch) {
        branchCheckInterval = setInterval(() => {
          checkBranchChange().catch(() => {
            // Silently handle errors in background check
          })
        }, 2000)
      }

      await client.app.log({
        body: {
          service: "opencode-worktrunk",
          level: "info",
          message: `WorkTrunk plugin initialized${currentBranch ? ` for branch: ${currentBranch}` : ""}`,
        },
      })
    } catch (error) {
      // Initialization failed, plugin will work without branch tracking
      await client.app.log({
        body: {
          service: "opencode-worktrunk",
          level: "warn",
          message: `WorkTrunk plugin init failed: ${error}`,
        },
      })
    }
  }, 100)

  return {
    // Track session status changes
    event: async ({ event }) => {
      switch (event.type) {
        case "session.status": {
          // event.status contains the current status
          const status = (event as any).status
          if (status === "working" || status === "thinking") {
            updateStatus("🤖")
          } else if (status === "waiting" || status === "idle") {
            updateStatus("💬")
          } else {
            updateStatus(null)
          }
          break
        }

        case "session.created": {
          // Set initial status when session starts
          updateStatus("💬")
          break
        }

        case "session.idle": {
          // Clear marker when session becomes idle
          updateStatus(null)
          break
        }

        case "session.error": {
          // Clear marker on error
          updateStatus(null)
          break
        }
      }
    },

    // Custom tools for WorkTrunk operations
    tool: {
      "worktrunk-list": tool({
        description: `List all WorkTrunk worktrees with their status.

Examples:
- worktrunk-list() - List all worktrees in text format
- worktrunk-list({format: "json"}) - Get structured JSON output for parsing
- worktrunk-list({full: true, branches: true}) - Show PR/CI status for all branches including those without worktrees

Use cases:
- Check what branches have active worktrees
- Monitor CI status across all branches (use --full --branches)
- Get structured data for scripts (use format: "json")`,
        args: {
          format: tool.schema.string().optional().describe("Output format: 'text' (default) or 'json' for structured output"),
          full: tool.schema.boolean().optional().describe("Show full details including PR/CI status"),
          branches: tool.schema.boolean().optional().describe("Include branches without worktrees (useful with --full for CI monitoring)"),
        },
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            const format = args.format || "text"
            const parts: string[] = []
            
            if (format === "json") {
              parts.push("--format=json")
            }
            if (args.full) {
              parts.push("--full")
            }
            if (args.branches) {
              parts.push("--branches")
            }
            
            const flags = parts.length > 0 ? ` ${parts.join(" ")}` : ""
            const result = await $`wt list${flags}`.quiet()
            return result.stdout.toString()
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return `Error running 'wt list': ${errorMsg}\n\nTroubleshooting:\n- Ensure WorkTrunk is installed: wt --version\n- Check you're in a git repository: git rev-parse --git-dir\n- Verify WorkTrunk is initialized: wt list`
          }
        },
      }),

      "worktrunk-switch": tool({
        description: `Switch to a different WorkTrunk worktree/branch.

Examples:
- worktrunk-switch({branch: "feature/api"}) - Switch to feature/api branch
- worktrunk-switch({branch: "@"}) - Switch to current branch (refresh)
- worktrunk-switch({branch: "-"}) - Switch to previous worktree

Shortcuts:
- "@" - Current branch (useful for refreshing)
- "-" - Previous worktree (quick toggle)

Use when you need to change context to work on a different branch.`,
        args: {
          branch: tool.schema.string().describe("Branch name to switch to, or '@' for current branch, or '-' for previous worktree"),
        },
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            const result = await $`wt switch --yes ${args.branch}`.quiet()
            // Update currentBranch if not using shortcuts
            if (args.branch !== "@" && args.branch !== "-") {
              currentBranch = args.branch
              lastKnownBranch = args.branch
            } else {
              // For shortcuts, refresh current branch after switch
              currentBranch = await getCurrentBranch()
              lastKnownBranch = currentBranch
            }
            updateStatus("💬")
            return `Switched to branch: ${args.branch}\n${result.stdout.toString()}`
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return `Error switching to branch '${args.branch}': ${errorMsg}\n\nTroubleshooting:\n- Ensure the branch exists: wt list\n- Check branch name spelling\n- Verify you're in a WorkTrunk-managed repository`
          }
        },
      }),

      "worktrunk-status": tool({
        description: `Get current WorkTrunk status for the active branch.

Example:
- worktrunk-status() - Shows status of the current branch

Use this to check the current branch's worktree status, including any status markers set by the plugin (🤖 working, 💬 waiting).`,
        args: {},
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            // Always refresh branch to handle external changes
            currentBranch = await getCurrentBranch()
            lastKnownBranch = currentBranch
            
            if (!currentBranch) {
              return "Not in a git repository or no branch detected.\n\nTroubleshooting:\n- Ensure you're in a git repository: git rev-parse --git-dir\n- Check you're on a branch (not detached HEAD): git branch"
            }

            const result = await $`wt list --branch ${currentBranch}`.quiet()
            return result.stdout.toString() || `Current branch: ${currentBranch}`
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return `Error getting WorkTrunk status: ${errorMsg}`
          }
        },
      }),

      "worktrunk-status-update": tool({
        description: `Manually update WorkTrunk status marker for the current branch.

Examples:
- worktrunk-status-update({marker: "🤖"}) - Set working marker
- worktrunk-status-update({marker: "💬"}) - Set waiting marker
- worktrunk-status-update({marker: ""}) - Clear marker
- worktrunk-status-update({marker: "🚧", branch: "feature/x"}) - Update specific branch

Use cases:
- Explicit status changes when automatic tracking misses updates
- Recovery from missed status updates
- Custom status markers for specific workflows
- Setting status on branches other than current

The plugin automatically manages status markers, but this tool allows manual control when needed.`,
        args: {
          marker: tool.schema.string().describe("Status marker to set (e.g., '🤖', '💬', or '' to clear). Use empty string to clear marker."),
          branch: tool.schema.string().optional().describe("Branch name to update. Defaults to current branch. Use '@' for current branch."),
        },
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            let targetBranch = args.branch
            
            // Handle shortcuts and defaults
            if (!targetBranch || targetBranch === "@") {
              targetBranch = await getCurrentBranch() ?? undefined
              if (!targetBranch) {
                return "Not in a git repository or no branch detected.\n\nTroubleshooting:\n- Ensure you're in a git repository: git rev-parse --git-dir\n- Check you're on a branch (not detached HEAD): git branch"
              }
            }
            
            // Update the marker directly using wt command
            const markerValue = args.marker || ""
            await $`wt config state marker set "${markerValue}" --branch ${targetBranch}`.quiet()
            
            // Also update currentBranch tracking if updating current branch
            if (!args.branch || args.branch === "@") {
              currentBranch = targetBranch
              lastKnownBranch = targetBranch
            }
            
            const markerDisplay = args.marker || "(cleared)"
            return `Updated status marker for branch '${targetBranch}': ${markerDisplay}`
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return `Error updating status marker: ${errorMsg}`
          }
        },
      }),

      "worktrunk-create": tool({
        description: `Create a new WorkTrunk worktree for a branch.

Examples:
- worktrunk-create({branch: "feature/new-feature"}) - Create worktree from default branch
- worktrunk-create({branch: "feature/part2", base: "@"}) - Create stacked branch from current HEAD
- worktrunk-create({branch: "feature/part2", base: "feature/part1"}) - Create stacked branch from another branch
- worktrunk-create({branch: "@"}) - Create worktree for current branch

Stacked branches:
- Use base: "@" to branch from current HEAD (enables incremental feature development)
- Chain multiple stacked branches: part1 -> part2 -> part3

Shortcuts:
- "@" - Current branch name

Use this when starting work on a new feature branch.`,
        args: {
          branch: tool.schema.string().describe("Branch name to create worktree for, or '@' for current branch"),
          base: tool.schema.string().optional().describe("Base branch or commit to branch from. Use '@' to branch from current HEAD (stacked branches)."),
          skipHooks: tool.schema.boolean().optional().describe("Skip git hooks during creation (--no-verify). Default: false"),
        },
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          // Validate branch name
          if (args.branch && !/^[@\w\/\-\.]+$/.test(args.branch) && args.branch !== "@") {
            return `Error: Invalid branch name '${args.branch}'. Branch names should only contain letters, numbers, slashes, hyphens, dots, or '@' for current branch.`
          }
          
          try {
            const flags = args.skipHooks ? ['--yes', '--no-verify'] : ['--yes']
            if (args.base) {
              const result = await $`wt switch --create ${flags} ${args.branch} --base=${args.base}`.quiet()
              currentBranch = args.branch
              lastKnownBranch = args.branch
              updateStatus("💬")
              const baseInfo = args.base === "@" ? "current HEAD" : args.base
              return `Created and switched to branch: ${args.branch} (from ${baseInfo})\n${result.stdout.toString()}`
            } else {
              const result = await $`wt switch --create ${flags} ${args.branch}`.quiet()
              currentBranch = args.branch
              lastKnownBranch = args.branch
              updateStatus("💬")
              return `Created and switched to branch: ${args.branch}\n${result.stdout.toString()}`
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (errorMsg.includes("already exists")) {
              return `Error: Branch '${args.branch}' already exists. Use worktrunk-switch to switch to it, or choose a different name.`
            }
            return `Error creating worktree for branch '${args.branch}': ${errorMsg}`
          }
        },
      }),

      "worktrunk-remove": tool({
        description: `Remove a WorkTrunk worktree.

Examples:
- worktrunk-remove({branch: "feature/old"}) - Remove worktree for feature/old
- worktrunk-remove({branch: "@"}) - Remove current worktree

Shortcuts:
- "@" - Current worktree

Use this to clean up worktrees when you're done with a branch. The plugin will automatically detect if you're no longer in a git repo after removal.`,
        args: {
          branch: tool.schema.string().describe("Branch name or worktree to remove, or '@' for current worktree"),
        },
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            const result = await $`wt remove --yes ${args.branch}`.quiet()
            // If removing current worktree, clear currentBranch and refresh
            if (args.branch === "@" || args.branch === currentBranch) {
              currentBranch = null
              lastKnownBranch = null
              // Refresh to see if we're still in a repo
              const newBranch = await getCurrentBranch()
              if (newBranch) {
                currentBranch = newBranch
                lastKnownBranch = newBranch
              }
            }
            return `Removed worktree: ${args.branch}\n${result.stdout.toString()}`
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (errorMsg.includes("not found") || errorMsg.includes("does not exist")) {
              return `Error: Worktree '${args.branch}' not found. Use 'worktrunk-list' to see available worktrees.`
            }
            return `Error removing worktree '${args.branch}': ${errorMsg}`
          }
        },
      }),

      "worktrunk-default-branch": tool({
        description: `Get the default branch name dynamically.

Example:
- worktrunk-default-branch() - Returns "main" or "master" or other default

Use cases:
- Scripts that need to work on any repo (main/master agnostic)
- Switching to default branch: worktrunk-switch({branch: <default>})
- Comparing against default branch

This tool works regardless of whether the default is 'main', 'master', or any other name.`,
        args: {},
        async execute(args, ctx) {
          if (!(await isWorkTrunkInstalled())) {
            return "Error: WorkTrunk is not installed. Please install it from https://worktrunk.dev/install"
          }
          
          try {
            const result = await $`wt config state default-branch`.quiet()
            const branch = result.stdout.toString().trim()
            return branch || "Unable to determine default branch. WorkTrunk may not be initialized in this repository."
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return `Error getting default branch: ${errorMsg}\n\nTroubleshooting:\n- Ensure WorkTrunk is initialized: wt list\n- Check repository configuration: wt config state`
          }
        },
      }),
    },
  }
}

export default plugin
