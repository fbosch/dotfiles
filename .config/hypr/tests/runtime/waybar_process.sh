#!/usr/bin/env bash

set -euo pipefail

hypr_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$hypr_dir/runtime/desktop/waybar-process.sh" <<'PY'
import json
import os
import select
import signal
import subprocess
import sys
import tempfile
import textwrap
import uuid
from pathlib import Path

helper = sys.argv[1]
signature = f"waybar-process-test-{uuid.uuid4().hex}"
worker_code = r'''
import ctypes
import signal
import sys

# Match the kernel process name used by both plain and Nix-wrapped Waybar.
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(15, ctypes.c_char_p(sys.argv[1].encode()), 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "prctl failed")


def received(number, _frame):
    print(signal.Signals(number).name, flush=True)
    if number == signal.SIGTERM:
        sys.exit(0)


for number in (signal.SIGUSR1, signal.SIGUSR2, signal.SIGTERM):
    signal.signal(number, received)
print("ready", flush=True)
while True:
    signal.pause()
'''


def command(action, *args, instance=signature, expected=0):
    result = subprocess.run(
        [helper, action, *args],
        env={**os.environ, "HYPRLAND_INSTANCE_SIGNATURE": instance},
        capture_output=True,
        text=True,
        timeout=3,
    )
    assert result.returncode == expected, (
        f"{action} {args}: expected status {expected}, got {result.returncode}; {result.stderr}"
    )


def expect(worker, line):
    assert select.select([worker.stdout], [], [], 3)[0], f"fixture did not report {line}"
    assert worker.stdout.readline().strip() == line


for name in (".waybar-wrapped", "waybar"):
    workers = []
    try:
        for instance in (signature, signature + "-other"):
            worker = subprocess.Popen(
                [sys.executable, "-u", "-c", worker_code, name],
                env={**os.environ, "HYPRLAND_INSTANCE_SIGNATURE": instance},
                stdout=subprocess.PIPE,
                text=True,
            )
            workers.append(worker)
            expect(worker, "ready")
        owned, other = workers
        command("running")
        command("running", instance=signature + "-missing", expected=1)
        for number in ("USR1", "USR2"):
            command("signal", number)
            expect(owned, "SIG" + number)
            assert not select.select([other.stdout], [], [], 0)[0], "signaled another instance"
        command("signal", "KILL", expected=2)
        command("signal", "TERM")
        expect(owned, "SIGTERM")
        assert owned.wait(timeout=3) == 0
        command("running", expected=1)
        command("signal", "USR1", expected=1)
        assert other.poll() is None, "terminated another instance"
        assert not select.select([other.stdout], [], [], 0)[0], "signaled another instance"
    finally:
        # Only terminate fixture processes created by this test.
        for worker in workers:
            if worker.poll() is None:
                worker.terminate()
            worker.wait(timeout=3)


def write_executable(path, content):
    path.write_text(textwrap.dedent(content).lstrip())
    path.chmod(0o755)


def replace_unit(active, stop_status):
    with tempfile.TemporaryDirectory() as temporary:
        temporary_path = Path(temporary)
        bin_dir = temporary_path / "bin"
        bin_dir.mkdir()
        log = temporary_path / "commands"
        timeout_log = temporary_path / "timeouts"
        write_executable(
            bin_dir / "timeout",
            """\
            #!/usr/bin/env python3
            import json
            import os
            import sys
            with open(os.environ["WAYBAR_REPLACE_TIMEOUT_LOG"], "a") as handle:
                handle.write(json.dumps(sys.argv[1:]) + "\\n")
            arguments = sys.argv[1:]
            while arguments and (arguments[0].startswith("-") or arguments[0].endswith("s")):
                arguments.pop(0)
            os.execvp(arguments[0], arguments)
            """,
        )
        write_executable(
            bin_dir / "systemctl",
            """\
            #!/usr/bin/env python3
            import os
            import sys
            with open(os.environ["WAYBAR_REPLACE_LOG"], "a") as handle:
                handle.write("systemctl " + " ".join(sys.argv[1:]) + "\\n")
            if sys.argv[1:4] == ["--user", "is-active", "--quiet"]:
                sys.exit(int(os.environ["WAYBAR_REPLACE_ACTIVE"]))
            if sys.argv[1:3] == ["--user", "stop"]:
                sys.exit(int(os.environ["WAYBAR_REPLACE_STOP_STATUS"]))
            sys.exit(64)
            """,
        )
        write_executable(
            bin_dir / "uwsm-app",
            """\
            #!/usr/bin/env python3
            import os
            import sys
            with open(os.environ["WAYBAR_REPLACE_LOG"], "a") as handle:
                handle.write("uwsm-app " + " ".join(sys.argv[1:]) + "\\n")
            """,
        )
        environment = {
            **os.environ,
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
            "HYPRLAND_INSTANCE_SIGNATURE": signature,
            "WAYBAR_REPLACE_LOG": str(log),
            "WAYBAR_REPLACE_TIMEOUT_LOG": str(timeout_log),
            "WAYBAR_REPLACE_ACTIVE": str(active),
            "WAYBAR_REPLACE_STOP_STATUS": str(stop_status),
        }
        result = subprocess.run(
            [helper, "replace-unit", f"uwsm-app -s s -t service -u app-Hyprland-waybar-demand-{signature}.service -S both -- waybar"],
            env=environment,
            capture_output=True,
            text=True,
            timeout=3
        )
        commands = log.read_text().splitlines() if log.exists() else []
        timeouts = [json.loads(line) for line in timeout_log.read_text().splitlines()] if timeout_log.exists() else []
        return result, commands, timeouts


unit = f"app-Hyprland-waybar-demand-{signature}.service"
running, running_commands, running_timeouts = replace_unit(active=0, stop_status=0)
assert running.returncode == 0, running.stderr
assert running_commands == [
    f"systemctl --user is-active --quiet {unit}",
    f"systemctl --user stop {unit}",
    f"uwsm-app -s s -t service -u {unit} -S both -- waybar",
]
assert len(running_timeouts) == 1, "replace-unit must use one aggregate timeout"
assert running_timeouts[0][:5] == ["--foreground", "--kill-after=1", "5s", "sh", "-c"]
assert running_timeouts[0][6:8] == ["sh", unit]

inactive, inactive_commands, inactive_timeouts = replace_unit(active=1, stop_status=0)
assert inactive.returncode == 0, inactive.stderr
assert inactive_commands == [
    f"systemctl --user is-active --quiet {unit}",
    f"uwsm-app -s s -t service -u {unit} -S both -- waybar",
]
assert len(inactive_timeouts) == 1

failed_stop, failed_stop_commands, failed_stop_timeouts = replace_unit(active=0, stop_status=1)
assert failed_stop.returncode == 1
assert failed_stop_commands == [
    f"systemctl --user is-active --quiet {unit}",
    f"systemctl --user stop {unit}",
]
assert len(failed_stop_timeouts) == 1
command("replace-unit", expected=2)

print("PASS Waybar process control isolates instances and replaces the exact unit within one timeout")
PY
