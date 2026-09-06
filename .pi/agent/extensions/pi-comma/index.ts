import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STARTUP_TIMEOUT_MS = 1_000;
const FORCE_KILL_DELAY_MS = 100;

interface SetupOptions {
  commaPath: string;
  pickerPath: string;
  nixStore?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build a per-invocation handler; nothing is exported to the user's shell. */
export function createSetupFragment({
  commaPath,
  pickerPath,
  nixStore = "/nix/store",
}: SetupOptions): string {
  const comma = shellQuote(commaPath);
  const picker = shellQuote(pickerPath);
  const store = shellQuote(nixStore);

  return `
# pi-comma is intentionally local to this bash invocation.
if ! declare -F command_not_found_handle >/dev/null 2>&1; then
  command_not_found_handle() {
    local command_name="$1"
    shift

    case "$command_name" in
      */*) return 127 ;;
    esac
    if [[ -n "\${__PI_COMMA_RESOLVING:-}" ]]; then
      return 127
    fi
    # comma 2.4.1 documents this environment variable for its --ask option.
    case "\${COMMA_ASK_TO_CONFIRM:-}" in
      ""|0|[Ff][Aa][Ll][Ss][Ee]|[Nn][Oo]|[Oo][Ff][Ff]) ;;
      *)
        printf '%s\\n' 'pi-comma: automatic recovery cannot bypass COMMA_ASK_TO_CONFIRM' >&2
        return 127
        ;;
    esac

    local output resolved_path relative_path status
    local __PI_COMMA_RESOLVING=1
    printf 'pi-comma: resolving %s with comma\\n' "$command_name" >&2
    # Command substitution does not consume this command's stdin. The record
    # separator retains comma's status without a temporary file or mapfile.
    output="$(
      ${comma} --print-path --picker ${picker} -- "$command_name" </dev/null
      printf '\\037%s' "$?"
    )"
    status="\${output##*$'\\037'}"
    resolved_path="\${output%$'\\037'*}"
    # Comma conventionally terminates its one path record with a newline.
    resolved_path="\${resolved_path%$'\\n'}"
    if [[ ! "$status" =~ ^[0-9]+$ ]] || (( status != 0 )); then
      printf 'pi-comma: comma could not resolve %s\\n' "$command_name" >&2
      return 127
    fi

    case "$resolved_path" in
      ${store}/*) relative_path="\${resolved_path#${store}/}" ;;
      *)
        printf 'pi-comma: comma returned an invalid executable path for %s\\n' "$command_name" >&2
        return 127
        ;;
    esac
    # Reject lexical escapes before touching the filesystem.
    case "/$relative_path/" in
      *'//'*)
        printf 'pi-comma: comma returned an invalid executable path for %s\\n' "$command_name" >&2
        return 127
        ;;
      *'/./'*|*'/../'*)
        printf 'pi-comma: comma returned an invalid executable path for %s\\n' "$command_name" >&2
        return 127
        ;;
    esac
    if [[ -z "$relative_path" || "$resolved_path" =~ [[:cntrl:]] || ! -f "$resolved_path" || ! -x "$resolved_path" ]]; then
      printf 'pi-comma: comma returned an invalid executable path for %s\\n' "$command_name" >&2
      return 127
    fi

    "$resolved_path" "$@"
    return $?
  }
fi
`.trimStart();
}

function resolveCommaPath(path = process.env.PATH): string | undefined {
  if (path === undefined) return undefined;
  for (const directory of path.split(delimiter)) {
    const candidate = resolve(directory || ".", "comma");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return undefined;
}

export async function isCommaAvailable(
  commaPath = resolveCommaPath(),
  timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<boolean> {
  if (commaPath === undefined) return false;
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let child: ChildProcess;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill !== undefined) clearTimeout(forceKill);
      resolve(available);
    };
    try {
      child = spawn(commaPath, ["--version"], { stdio: "ignore", windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_DELAY_MS);
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(!timedOut && code === 0));
  });
}

function isBuiltInLocalBash(pi: ExtensionAPI): boolean {
  // ToolInfo provenance is Pi's supported ownership API. The CLI marker avoids
  // changing SDK-provided Bash operations, for which no backend identity API exists.
  return (
    process.env.PI_CODING_AGENT === "true" &&
    pi
      .getAllTools()
      .some(
        (tool) =>
          tool.name === "bash" &&
          tool.sourceInfo.source === "builtin" &&
          tool.sourceInfo.path === "<builtin:bash>",
      )
  );
}

export default async function piCommaExtension(pi: ExtensionAPI): Promise<void> {
  if (process.platform !== "linux" && process.platform !== "darwin") return;
  if (!isBuiltInLocalBash(pi)) return;
  const commaPath = resolveCommaPath();
  if (commaPath === undefined || !(await isCommaAvailable(commaPath))) return;

  const pickerPath = fileURLToPath(new URL("./ambiguous-picker.sh", import.meta.url));
  const setup = createSetupFragment({ commaPath, pickerPath });

  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    event.input.command = `${setup}\n${event.input.command}`;
  });
}
