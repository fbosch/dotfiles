#!/usr/bin/env python3
"""Opt-in Socket2 probe. Mutations require the private nested signature and PID.

Run with --skip-monitor-tests and TEST_HYPRLAND_DIR/TEST_PLUGIN set to matching builds.
This probe covers one output; monitor crossing, removal, and layout tests are omitted.
The artifact directory is retained for commands, events, and compositor logs.
"""

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path

parser = argparse.ArgumentParser(description="Test pointer-edge Socket2 behavior in a private single-output compositor.")
parser.add_argument(
    "--skip-monitor-tests", action="store_true", required=True,
    help="Acknowledge that this probe does not test monitor crossing, removal, or layout changes.",
)
parser.parse_args()

root = Path(tempfile.mkdtemp(prefix="pe."))
print("ARTIFACTS", root, flush=True)
parent_signature = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
parent_display = Path(os.environ["XDG_RUNTIME_DIR"]) / os.environ["WAYLAND_DISPLAY"]
hypr_bin = Path(os.environ["TEST_HYPRLAND_DIR"]).resolve()
plugin = Path(os.environ["TEST_PLUGIN"]).resolve()
assert parent_signature and parent_display.is_socket()
assert (hypr_bin / "Hyprland").is_file() and (hypr_bin / "hyprctl").is_file()
assert plugin.is_file() and plugin.name == "libpointer-edge-hooks.so"
for name in ("home", "config", "state", "cache", "data"):
    (root / name).mkdir(mode=0o700)
env = {
    "PATH": os.environ["PATH"],
    "HOME": str(root / "home"),
    "XDG_RUNTIME_DIR": str(root),
    "XDG_CONFIG_HOME": str(root / "config"),
    "XDG_STATE_HOME": str(root / "state"),
    "XDG_CACHE_HOME": str(root / "cache"),
    "XDG_DATA_HOME": str(root / "data"),
    "WAYLAND_DISPLAY": str(parent_display),
    "AQ_BACKEND": "wayland",
    "HYPRLAND_NO_SD_VARS": "1",
    "HYPRLAND_NO_SD_TARGET": "1",
    "HYPRLAND_NO_SD_NOTIFY": "1",
    "NO_SD_TARGET": "1",
    "NO_SD_NOTIFY": "1",
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(root / "no-bus"),
}
for name in ("LUA_PATH", "LUA_CPATH"):
    if os.environ.get(name):
        env[name] = os.environ[name]
adapter = (Path(__file__).resolve().parents[2] / "plugins/pointer_edge_hooks.lua").read_text()
assert "exec_cmd" not in adapter and "pointer_edge_hooks.zone" not in adapter
assert "nc -U" not in adapter and "pointer-zone" not in adapter
print("PASS adapter has no per-transition shell forwarding", flush=True)
config = root / "config/hyprland.lua"
config.write_text(
    "hl.monitor({output='',mode='preferred',position='0x0',scale=1})\n"
    "hl.config({animations={enabled=false}})\n"
)
proc = None
signature = None
observer = None
stream = b""
log = (root / "compositor.log").open("wb")


def assert_private():
    assert proc and proc.poll() is None, "nested compositor stopped"
    assert signature and signature != parent_signature
    instance = root / "hypr" / signature
    assert instance.is_dir() and (instance / ".socket.sock").is_socket()
    assert (instance / ".socket2.sock").is_socket()
    assert os.environ["XDG_RUNTIME_DIR"] != env["XDG_RUNTIME_DIR"]
    return instance


def call(*args):
    assert_private()
    assert signature is not None
    command = [str(hypr_bin / "hyprctl"), "-i", signature, *args]
    result = subprocess.run(
        command, env={**env, "HYPRLAND_INSTANCE_SIGNATURE": signature},
        text=True, capture_output=True, timeout=8, check=False,
    )
    with (root / "commands.log").open("a") as record:
        record.write(json.dumps({"args": args, "exit": result.returncode,
                                 "stdout": result.stdout, "stderr": result.stderr}) + "\n")
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    return result.stdout.strip()


def lua(expression):
    return call("eval", expression)


def dispatch(expression):
    return call("dispatch", expression)


def monitors():
    return json.loads(call("-j", "monitors"))


def connect():
    client = socket.socket(socket.AF_UNIX)
    client.settimeout(1)
    client.connect(str(assert_private() / ".socket2.sock"))
    client.settimeout(0.12)
    return client


def events(label):
    global stream
    assert observer is not None
    received = []
    while True:
        try:
            data = observer.recv(65536)
        except TimeoutError:
            break
        assert data, "Socket2 disconnected unexpectedly"
        stream += data
        while b"\n" in stream:
            line, stream = stream.split(b"\n", 1)
            received.append(line.decode())
    zones = [line for line in received if line.startswith("pointeredgezone>>")]
    with (root / "events.log").open("a") as record:
        record.write(json.dumps({"label": label, "all": received, "zones": zones}) + "\n")
    print("EVENTS", label, zones, flush=True)
    return zones


def expect(label, expected):
    actual = events(label)
    assert actual == expected, (label, expected, actual)


def point(monitor, distance):
    return monitor["x"] + min(100, monitor["width"] // 2), monitor["y"] + monitor["height"] - distance


def move(monitor, distance):
    x, y = point(monitor, distance)
    dispatch(f"hl.dsp.cursor.move({{x={x},y={y}}})")


try:
    proc = subprocess.Popen(
        [str(hypr_bin / "Hyprland"), "--config", str(config)],
        env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
    )
    for _ in range(100):
        assert proc.poll() is None, "nested compositor exited during startup"
        paths = list((root / "hypr").iterdir()) if (root / "hypr").exists() else []
        candidates = [path for path in paths if (path / ".socket.sock").is_socket()
                      and (path / ".socket2.sock").is_socket()]
        if len(candidates) == 1:
            signature = candidates[0].name
            break
        time.sleep(0.1)
    assert_private()
    instances = json.loads(call("-j", "instances"))
    assert any(item["instance"] == signature and item["pid"] == proc.pid for item in instances)
    print("VERSION", call("version"), flush=True)
    print("SANDBOX", signature, "PID", proc.pid, flush=True)
    assert not call("configerrors")
    observer = connect()
    events("connected")
    print("LOAD", call("plugin", "load", str(plugin)), flush=True)
    assert not call("configerrors")
    events("load")
    base = next(m for m in monitors() if m["name"] == "WAYLAND-1")
    base_id = base["id"]
    move(base, 90)
    events("position-before-start")
    lua("assert(hl.plugin.pointer_edge_hooks.start(20,60))")
    expect("start-hide", [f"pointeredgezone>>hide,{base_id}"])
    lua("assert(hl.plugin.pointer_edge_hooks.sync())")
    expect("forced-sync", [f"pointeredgezone>>hide,{base_id}"])
    move(base, 90)
    expect("same-zone-dedup", [])
    move(base, 40)
    expect("neutral", [f"pointeredgezone>>neutral,{base_id}"])
    move(base, 10)
    expect("show", [f"pointeredgezone>>show,{base_id}"])
    move(base, 5)
    expect("show-dedup", [])

    observer.close()
    observer = connect()
    stream = b""
    events("reconnect-before-sync")
    move(base, 5)
    events("reconnect-position")
    lua("assert(hl.plugin.pointer_edge_hooks.sync())")
    expect("reconnect-sync", [f"pointeredgezone>>show,{base_id}"])

    print("SKIP monitor crossing/removal/layout reconfiguration: explicitly excluded by --skip-monitor-tests", flush=True)

    call("reload")
    assert not call("configerrors")
    events("config-reload")
    lua("assert(hl.plugin.pointer_edge_hooks.sync())")
    expect("sync-after-reload", [f"pointeredgezone>>show,{base_id}"])
    lua("assert(hl.plugin.pointer_edge_hooks.stop())")
    expect("stop-neutral", [f"pointeredgezone>>neutral,{base_id}"])
    move(base, 40)
    expect("stopped-movement", [])
    lua("assert(hl.plugin.pointer_edge_hooks.start(20,60))")
    expect("restart-neutral", [f"pointeredgezone>>neutral,{base_id}"])
    move(base, 10)
    expect("restart-show", [f"pointeredgezone>>show,{base_id}"])
    call("plugin", "unload", str(plugin))
    expect("unload-neutral", [f"pointeredgezone>>neutral,{base_id}"])
    call("plugin", "load", str(plugin))
    events("reload-plugin")
    lua("assert(hl.plugin.pointer_edge_hooks.start(20,60))")
    expect("plugin-reloaded", [f"pointeredgezone>>show,{base_id}"])
    assert not call("configerrors")
    print("PASS isolated pointer-edge lifecycle", flush=True)
finally:
    if observer:
        observer.close()
    if signature and proc and proc.poll() is None:
        try:
            dispatch("hl.dsp.exit()")
            proc.wait(timeout=4)
        except (AssertionError, subprocess.TimeoutExpired, OSError) as error:
            print("EXIT NOTE", error, flush=True)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=4)
    log.close()
    print("PRIMARY", parent_signature, "SANDBOX_STOPPED", proc is None or proc.poll() is not None, flush=True)
