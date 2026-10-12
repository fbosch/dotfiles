#!/usr/bin/env python3
"""Exercise native tiled drops in a private nested compositor, never the host instance."""
import json
import os
import select
import subprocess
import tempfile
import time
from pathlib import Path

root = Path(tempfile.mkdtemp(prefix="wi."))
print("ARTIFACTS", root, flush=True)
primary_signature = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
primary_runtime = Path(os.environ["XDG_RUNTIME_DIR"])
parent_display = primary_runtime / os.environ["WAYLAND_DISPLAY"]
bins = Path(os.environ["TEST_HYPRLAND_DIR"]).resolve()
plugin = Path(os.environ["TEST_PLUGIN"]).resolve()
gtk = Path(os.environ["TEST_GTK_LIBRARY"]).resolve()
config_root = Path(__file__).resolve().parents[2]
assert parent_display.is_socket() and plugin.is_file() and gtk.is_file()
assert plugin.name == "libwindow-interaction-hooks.so"
assert (bins / "Hyprland").is_file() and (bins / "hyprctl").is_file()
for name in ("home", "config", "state", "cache", "data"):
    (root / name).mkdir(mode=0o700)
env = {
    "PATH": os.environ["PATH"], "HOME": str(root / "home"),
    "XDG_RUNTIME_DIR": str(root), "XDG_CONFIG_HOME": str(root / "config"),
    "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"),
    "XDG_DATA_HOME": str(root / "data"), "WAYLAND_DISPLAY": str(parent_display),
    "AQ_BACKEND": "wayland", "HYPRLAND_NO_SD_VARS": "1", "HYPRLAND_NO_SD_TARGET": "1",
    "HYPRLAND_NO_SD_NOTIFY": "1", "NO_SD_TARGET": "1", "NO_SD_NOTIFY": "1",
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(root / "no-bus"),
}
config = root / "config/hyprland.lua"
events_path = root / "events.log"
config.write_text(
    "hl.monitor({output='',mode='preferred',position='auto',scale=1})\n"
    "hl.config({animations={enabled=false},input={follow_mouse=0},binds={drag_threshold=0},general={gaps_in=0,gaps_out=0,border_size=0}})\n"
    f"package.path={json.dumps(str(config_root) + '/?.lua;' + str(config_root) + '/?/init.lua;')}..package.path\n"
    "package.loaded['lib.monitor_role']={ultrawide='ultrawide',portrait='portrait',\n"
    " for_monitor=function(m) return m and (m.name=='WAYLAND-1' and 'ultrawide' or 'portrait') end,\n"
    " for_window=function(w) return w and (w.monitor.name=='WAYLAND-1' and 'ultrawide' or 'portrait') end,\n"
    " name_for=function(r) return r=='ultrawide' and 'WAYLAND-1' or 'WAYLAND-2' end}\n"
    "require('layouts.ultrawide_master'); require('layouts.portrait_rows')\n"
    "hl.workspace_rule({workspace='1',monitor='WAYLAND-1',layout='lua:ultrawide_master'})\n"
    "hl.workspace_rule({workspace='2',monitor='WAYLAND-2',layout='lua:portrait_rows'})\n"
    f"hl.plugin.load({json.dumps(str(plugin))}); assert(hl.plugin.window_interaction_hooks.rebind())\n"
    f"local function log(s) local f=assert(io.open({json.dumps(str(events_path))},'a')); f:write(s,'\\n'); f:close() end\n"
    "hl.on('window_interaction_hooks.updated',function(w,k) log('updated|'..w.title..'|'..k) end)\n"
    "hl.on('window_interaction_hooks.finished',function(w,k) log('finished|'..w.title..'|'..k) end)\n"
    "hl.on('window_interaction_hooks.dropped',function(w,ws,x,y)\n"
    " local accepted=require('lib.window.custom_layout').request_drop(w,ws,x,y)\n"
    " log('dropped|'..w.title..'|'..ws.id..'|'..x..'|'..y..'|'..tostring(accepted)) end)\n"
    "hl.bind('F8',hl.dsp.window.drag())\n"
    "hl.bind('F9',hl.dsp.window.resize())\n"
)
proc = fixture = keyboard = None
signature = None
log = (root / "compositor.log").open("wb")
fixture_log = (root / "fixture.log").open("wb")
checks = []


def private():
    assert proc and proc.poll() is None, "nested compositor stopped"
    assert signature and signature != primary_signature and root != primary_runtime
    assert (root / "hypr" / signature / ".socket.sock").is_socket()


def call(*args):
    private()
    assert signature is not None
    result = subprocess.run([str(bins / "hyprctl"), "-i", signature, *args],
                            env={**env, "HYPRLAND_INSTANCE_SIGNATURE": signature},
                            capture_output=True, text=True, timeout=8)
    with (root / "commands.log").open("a") as record:
        record.write(json.dumps({"args": args, "exit": result.returncode,
                                 "stdout": result.stdout, "stderr": result.stderr}) + "\n")
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    assert "stack traceback" not in result.stdout, result.stdout
    return result.stdout.strip()


def dispatch(expression):
    return call("dispatch", expression)


def clients():
    return json.loads(call("-j", "clients"))


def window(title):
    for _ in range(80):
        found = [w for w in clients() if w["title"] == title]
        if found:
            return found[0]
        assert fixture and fixture.poll() is None, "fixture stopped"
        time.sleep(0.025)
    raise AssertionError("window did not map: " + title)


def command(**options):
    assert fixture is not None and fixture.stdin is not None
    fixture.stdin.write(json.dumps(options) + "\n")
    fixture.stdin.flush()


def events():
    return events_path.read_text().splitlines() if events_path.exists() else []


def point(x, y):
    dispatch(f"hl.dsp.cursor.move({{x={x},y={y}}})")


def drag(title, destination, key="F8", change_focus=None):
    global keyboard
    w = window(title)
    dispatch(f"hl.dsp.focus({{window='address:{w['address']}'}})")
    point(w["at"][0] + w["size"][0] / 2, w["at"][1] + w["size"][1] / 2)
    baseline = len(events())
    keyboard = subprocess.Popen(["wtype", "-P", key, "-s", "900", "-p", key],
                                env=client_env, stdout=fixture_log, stderr=fixture_log)
    time.sleep(0.2)
    assert keyboard.poll() is None, "virtual keyboard stopped before drag"
    point(*destination)
    time.sleep(0.15)
    if change_focus:
        other = window(change_focus)
        dispatch(f"hl.dsp.focus({{window='address:{other['address']}'}})")
    assert keyboard.wait(timeout=3) == 0
    keyboard = None
    time.sleep(0.2)
    result = events()[baseline:]
    print("EVENTS", title, result, flush=True)
    assert any(e.startswith(f"finished|{title}|") for e in result), result
    assert not call("configerrors")
    return result


try:
    proc = subprocess.Popen([str(bins / "Hyprland"), "--config", str(config)],
                            env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        assert proc.poll() is None, "compositor exited at startup"
        paths = list((root / "hypr").glob("*/.socket.sock"))
        if len(paths) == 1:
            signature = paths[0].parent.name
            break
        time.sleep(0.1)
    private()
    instances = json.loads(call("-j", "instances"))
    assert any(i["instance"] == signature and i["pid"] == proc.pid for i in instances)
    print("SANDBOX", signature, "PID", proc.pid, flush=True)
    print("VERSION", call("version").splitlines()[0], flush=True)
    assert not call("configerrors")
    sockets = [p for p in root.glob("wayland-*") if p.is_socket()]
    assert len(sockets) == 1, sockets
    client_env = {**env, "WAYLAND_DISPLAY": str(sockets[0]), "GDK_BACKEND": "wayland",
                  "TEST_GTK_LIBRARY": str(gtk)}
    fixture = subprocess.Popen(["python3", str(Path(__file__).with_name("transient_placement_client.py"))],
                               env=client_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=fixture_log, text=True)
    assert fixture.stdout is not None
    assert select.select([fixture.stdout], [], [], 5)[0], "fixture startup timeout"
    assert fixture.stdout.readline().strip() == "ready"
    for title in ("A", "B", "C"):
        command(action="open", title=title, width=200, height=200)
        window(title)
    time.sleep(0.2)
    monitor = json.loads(call("-j", "monitors"))[0]
    right = (monitor["x"] + monitor["width"] - 50, monitor["y"] + monitor["height"] / 2)
    leftmost = min(clients(), key=lambda w: w["at"][0])["title"]
    result = drag(leftmost, right)
    assert sum(e.startswith("dropped|") for e in result) == 1, result
    assert result[-1].endswith("|true"), result
    assert max(clients(), key=lambda w: w["at"][0])["title"] == leftmost, clients()
    assert next(i for i, e in enumerate(result) if e.startswith("updated|")) < next(i for i, e in enumerate(result) if e.startswith("finished|"))
    checks.append("real tiled drag reorders exact target; update-before-finish; one drop")
    leftmost = min(clients(), key=lambda w: w["at"][0])["title"]
    other = next(w["title"] for w in clients() if w["title"] != leftmost)
    result = drag(leftmost, right, change_focus=other)
    assert any(e.startswith(f"dropped|{leftmost}|") and e.endswith("|true") for e in result), result
    assert max(clients(), key=lambda w: w["at"][0])["title"] == leftmost, clients()
    checks.append("focus change does not replace dragged identity")
    result = drag(leftmost, (right[0] - 50, right[1] + 30), key="F9")
    assert not any(e.startswith("dropped|") for e in result), result
    checks.append("resize emits no drop")
    w = window(leftmost)
    dispatch(f"hl.dsp.window.float({{window='address:{w['address']}'}})")
    result = drag(leftmost, (right[0] - 120, right[1] - 80))
    assert not any(e.startswith("dropped|") for e in result), result
    checks.append("originally floating move emits no drop")
    call("reload")
    assert not call("configerrors")
    time.sleep(0.2)
    title = min((w for w in clients() if not w["floating"]), key=lambda w: w["at"][0])["title"]
    result = drag(title, right)
    assert sum(e.startswith("dropped|") for e in result) == 1, result
    checks.append("reload rebinds targeted drop event")
    (root / "results.json").write_text(json.dumps({"signature": signature, "pid": proc.pid, "checks": checks}, indent=2))
    print("PASS", checks, flush=True)
finally:
    if keyboard and keyboard.poll() is None:
        keyboard.terminate()
        keyboard.wait(timeout=3)
    if fixture and fixture.poll() is None:
        fixture.terminate()
        fixture.wait(timeout=3)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    fixture_log.close()
    log.close()
