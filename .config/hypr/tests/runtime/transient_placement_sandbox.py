#!/usr/bin/env python3
"""Opt-in single-output probe; every mutation targets a verified private instance."""
import json
import os
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path

root = Path(tempfile.mkdtemp(prefix="tp."))
print("ARTIFACTS", root, flush=True)
primary_signature = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
primary_runtime = Path(os.environ["XDG_RUNTIME_DIR"])
parent_display = primary_runtime / os.environ["WAYLAND_DISPLAY"]
bins = Path(os.environ["TEST_HYPRLAND_DIR"])
plugin = Path(os.environ["TEST_PLUGIN"])
gtk_library = Path(os.environ["TEST_GTK_LIBRARY"])
assert parent_display.is_socket() and plugin.is_file() and gtk_library.is_file()
assert plugin.name == "libtransient-placement.so"
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
    "HYPR_TRANSIENT_PLACEMENT_PLUGIN": str(plugin),
}
config = root / "config/hyprland.lua"
opened = root / "opened.log"
config.write_text(
    "hl.monitor({output='',mode='preferred',position='0x0',scale=1})\n"
    "hl.config({animations={enabled=false},input={follow_mouse=0}})\n"
    "hl.window_rule({match={initial_title='^Parent-A$'},float=true,size='520 380',move='100 80'})\n"
    "hl.window_rule({match={initial_title='^Parent-B$'},float=true,size='500 350',move='650 80'})\n"
    "hl.window_rule({match={initial_title='^Child-.*$'},float=true,size='240 140'})\n"
    "hl.window_rule({match={initial_title='^Child-explicit$'},move='30 40'})\n"
    "hl.on('window.open',function(w)\n"
    " if w.initial_title and w.initial_title:sub(1,6)=='Child-' then\n"
    f"  local f=assert(io.open({json.dumps(str(opened))},'a'))\n"
    "  f:write(w.initial_title,'|',w.at.x,'|',w.at.y,'|',w.size.x,'|',w.size.y,'\\n'); f:close()\n"
    " end\n"
    "end)\n"
)
proc = None
fixture = None
signature = None
log = (root / "compositor.log").open("wb")
fixture_log = (root / "fixture.log").open("wb")
checks = []


def private():
    assert proc and proc.poll() is None, "private compositor stopped"
    assert signature and signature != primary_signature
    assert root != primary_runtime
    assert (root / "hypr" / signature / ".socket.sock").is_socket()


def call(*args):
    private()
    assert signature is not None
    result = subprocess.run(
        [str(bins / "hyprctl"), "-i", signature, *args],
        env={**env, "HYPRLAND_INSTANCE_SIGNATURE": signature},
        capture_output=True, text=True, timeout=8,
    )
    with (root / "commands.log").open("a") as record:
        record.write(json.dumps({"args": args, "exit": result.returncode,
                                 "stdout": result.stdout, "stderr": result.stderr}) + "\n")
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    return result.stdout.strip()


def lua(expression):
    output = call("eval", expression)
    assert "error" not in output.lower() and "stack traceback" not in output.lower(), output
    return output


def clients():
    return json.loads(call("-j", "clients"))


def window(title):
    for _ in range(80):
        found = [w for w in clients() if w["title"] == title]
        if found:
            return found[0]
        assert fixture and fixture.poll() is None, "fixture exited"
        time.sleep(0.025)
    raise AssertionError("window did not map: " + title)


def command(**options):
    assert fixture and fixture.poll() is None
    assert fixture.stdin is not None
    fixture.stdin.write(json.dumps(options) + "\n")
    fixture.stdin.flush()


def focus(title):
    address = window(title)["address"]
    call("dispatch", f"hl.dsp.focus({{window='address:{address}'}})")
    assert json.loads(call("-j", "activewindow"))["address"] == address


def configure(class_name, infer=True, prefixes=None):
    prefixes = prefixes if prefixes is not None else ["Child-"]
    fields = (f"parent_class={json.dumps(class_name)},child_class={json.dumps(class_name)},"
              f"infer_focused_parent={'true' if infer else 'false'},no_anim=true,"
              "child_title_prefixes={" + ",".join(map(json.dumps, prefixes)) + "}")
    rule = "{{" + fields + "}}"
    lua("assert(hl.plugin.transient_placement.configure(" + rule + "))")
    return rule


def initial(title):
    for _ in range(80):
        if opened.exists():
            for line in opened.read_text().splitlines():
                name, *values = line.split("|")
                if name == title:
                    return list(map(float, values))
        time.sleep(0.025)
    raise AssertionError("no first-open geometry for " + title)


def child(title, parent=None, centered_on=None):
    lua("hl.config({animations={enabled=" + ("true" if centered_on else "false") + "}})")
    command(action="open", title=title, parent=parent)
    current = window(title)
    geometry = initial(title)
    if centered_on:
        owner = window(centered_on)
        expected = [
            owner["at"][0] + (owner["size"][0] - current["size"][0]) / 2,
            owner["at"][1] + (owner["size"][1] - current["size"][1]) / 2,
        ]
        assert all(abs(a - b) <= 1 for a, b in zip(geometry[:2], expected, strict=True)), (title, geometry, expected)
        assert all(abs(a - b) <= 1 for a, b in zip(current["at"], expected, strict=True)), (title, current, expected)
        assert current["size"] == [240, 140], (title, current["size"])
        assert current.get("floating") is True
    checks.append({"title": title, "initial": geometry, "final_at": current["at"],
                   "final_size": current["size"], "centered_on": centered_on})
    command(action="close", title=title)
    for _ in range(80):
        if not any(w["title"] == title for w in clients()):
            break
        time.sleep(0.025)
    else:
        raise AssertionError("child did not close")
    return geometry


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
    assert any(w["instance"] == signature and w["pid"] == proc.pid for w in instances)
    assert not call("configerrors")
    print("VERSION", call("version").splitlines()[0], flush=True)
    call("plugin", "load", str(plugin))
    lua("assert(hl.plugin.transient_placement.configure({}))")
    monitors = json.loads(call("-j", "monitors"))
    assert len(monitors) == 1 and monitors[0]["width"] >= 900 and monitors[0]["height"] >= 600
    display = next(p for p in root.glob("wayland-*") if p.is_socket())
    fixture = subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("transient_placement_client.py"))],
        env={**env, "WAYLAND_DISPLAY": str(display), "GDK_BACKEND": "wayland",
             "TEST_GTK_LIBRARY": str(gtk_library)},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=fixture_log, text=True,
    )
    assert fixture.stdout is not None
    assert select.select([fixture.stdout], [], [], 5)[0], "fixture readiness timed out"
    assert fixture.stdout.readline().strip() == "ready", "fixture startup failed"
    command(action="open", title="Parent-A", width=520, height=380)
    a = window("Parent-A")
    command(action="open", title="Parent-B", width=500, height=350)
    window("Parent-B")
    class_name = a["initialClass"]
    rule = configure(class_name)
    focus("Parent-A")
    child("Child-inferred", centered_on="Parent-A")
    focus("Parent-B")
    child("Child-declared", parent="Parent-A", centered_on="Parent-A")
    configure(class_name, infer=False)
    focus("Parent-A")
    child("Child-declared-no-inference", parent="Parent-A", centered_on="Parent-A")
    baseline = child("Child-inference-disabled")
    configure(class_name)
    focus("Parent-A")
    explicit = child("Child-explicit")
    assert explicit[:2] == [30, 40], explicit
    configure(class_name, prefixes=["Allowed-"])
    focus("Parent-A")
    ignored = child("Child-title-filtered")
    assert ignored[:2] == baseline[:2], (ignored, baseline)
    rule = configure(class_name)
    invalid_inputs = [
        "{{parent_class='',child_class='x'}}",
        "{{parent_class='x',child_class='x',unknown=true}}",
        "{{parent_class='x',child_class='x',infer_focused_parent='true'}}",
        "{{parent_class='x',child_class='x',child_title_prefixes={''}}}",
        "{[2]={parent_class='x',child_class='x'}}",
        "{false}",
    ]
    for invalid in invalid_inputs:
        lua("local ok,err=hl.plugin.transient_placement.configure(" + invalid +
            ");assert(ok==nil and type(err)=='string')")
    focus("Parent-A")
    child("Child-after-invalid", centered_on="Parent-A")
    lua("assert(hl.plugin.transient_placement.configure({}))")
    focus("Parent-A")
    disabled = child("Child-empty-disabled")
    assert disabled[:2] == baseline[:2], (disabled, baseline)
    call("reload")
    assert not call("configerrors")
    rule = configure(class_name)
    focus("Parent-A")
    child("Child-after-reload", centered_on="Parent-A")
    call("plugin", "unload", str(plugin))
    focus("Parent-A")
    unloaded = child("Child-unloaded")
    assert unloaded[:2] == baseline[:2], (unloaded, baseline)
    call("plugin", "load", str(plugin))
    configure(class_name)
    focus("Parent-A")
    child("Child-plugin-reloaded", centered_on="Parent-A")
    config_root = str(Path(__file__).resolve().parents[2])
    lua("package.path=" + json.dumps(config_root + "/?.lua;" + config_root + "/?/init.lua;") +
        "..package.path;assert(require('rules.transient_placement').register())")
    print("PASS Lua adapter configures the actual native API", flush=True)
    assert not call("configerrors")
    (root / "results.json").write_text(json.dumps(checks, indent=2) + "\n")
    print("PASS", len(checks), "isolated initial-placement/lifecycle cases", flush=True)
    print("SKIP multi-monitor, real app workflows, XWayland", flush=True)
finally:
    if fixture and fixture.poll() is None:
        fixture.terminate()
        try:
            fixture.wait(timeout=4)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.wait()
    if signature and proc and proc.poll() is None:
        try:
            call("dispatch", "hl.dsp.exit()")
            proc.wait(timeout=4)
        except (AssertionError, subprocess.TimeoutExpired, OSError):
            pass
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    log.close()
    fixture_log.close()
    print("SANDBOX_STOPPED", proc is None or proc.poll() is not None, flush=True)
