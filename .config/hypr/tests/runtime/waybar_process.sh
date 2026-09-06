#!/usr/bin/env bash

set -euo pipefail

hypr_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$hypr_dir/runtime/desktop/waybar-process.sh" <<'PY'
import os
import select
import signal
import subprocess
import sys
import uuid

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
        capture_output=True, text=True, timeout=3,
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
                stdout=subprocess.PIPE, text=True,
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

print("PASS Waybar process control supports Nix wrappers and isolates compositor instances")
PY
