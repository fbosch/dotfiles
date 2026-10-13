#!/usr/bin/env python3
"""Opt-in target-handle checks, restricted to an owned nested Hyprland instance."""
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time


def required_path(name, directory=False):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing {name}")
    path = Path(value).expanduser().resolve()
    if not (path.is_dir() if directory else path.is_file()):
        raise SystemExit(f"invalid {name}: {path}")
    return path


bins = required_path("TEST_HYPRLAND_DIR", True)
plugin = required_path("TEST_PLUGIN")
gtk = required_path("TEST_GTK_LIBRARY")
config_root = required_path("TEST_CONFIG_ROOT", True)
virtual_pointer = required_path("TEST_VIRTUAL_POINTER")
if config_root == Path(__file__).resolve().parents[2]:
    raise SystemExit("TEST_CONFIG_ROOT must be a staged copy, not the watched live config")
assert plugin.name == "libwindow-interaction-hooks.so"
for name in ("Hyprland", "hyprctl"):
    assert (bins / name).is_file()
primary_signature = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
primary_runtime = Path(os.environ["XDG_RUNTIME_DIR"]).resolve()
parent_display = Path(os.environ["WAYLAND_DISPLAY"])
if not parent_display.is_absolute():
    parent_display = primary_runtime / parent_display
assert parent_display.is_socket()
root = Path(tempfile.mkdtemp(prefix="wt."))
root.chmod(0o700)
print("ARTIFACTS", root, flush=True)
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
    "HYPR_WINDOW_INTERACTION_HOOKS_PLUGIN": str(plugin),
}
# Nix's nested Wayland EGL loader needs the already-installed vendor libraries.
if Path("/run/opengl-driver/lib").is_dir():
    env["LD_LIBRARY_PATH"] = "/run/opengl-driver/lib"
    env["__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS"] = "/run/opengl-driver/share/egl/egl_external_platform.d"
    env["__EGL_VENDOR_LIBRARY_DIRS"] = "/run/opengl-driver/share/glvnd/egl_vendor.d"
events_path = root / "events.log"
config = root / "config/hyprland.lua"
config.write_text(
    "hl.monitor({output='WAYLAND-1',mode='1600x900@60',position='0x0',scale=1})\n"
    "hl.config({animations={enabled=false},cursor={no_warps=true},input={follow_mouse=0,resolve_binds_by_sym=true},binds={drag_threshold=0},general={gaps_in=10,gaps_out=20,border_size=0}})\n"
    f"package.path={json.dumps(str(config_root) + '/?.lua;' + str(config_root) + '/?/init.lua;')}..package.path\n"
    f"hl.plugin.load({json.dumps(str(plugin))})\n"
    f"function __target_log(s) local f=assert(io.open({json.dumps(str(events_path))},'a')); f:write(s,'\\n'); f:close() end\n"
    "function __target_router_init()\n"
    " local adapter=require('plugins.window_interaction_hooks'); assert(adapter.enabled,adapter.error)\n"
    " __target_router=require('lib.window.pointer').new({picture_in_picture={\n"
    "  start_drag=function(w) __target_log('start_drag|'..w.title); return w.title=='PiP' end,\n"
    "  finish_drag=function(w) __target_log('finish_drag|'..(w and w.title or 'nil')) end,\n"
    "  start_resize=function(w) __target_log('start_resize|'..w.title); return w.title=='PiP' end,\n"
    "  finish_resize=function(w) __target_log('finish_resize|'..(w and w.title or 'nil')) end},\n"
    " custom_layout={start_custom_layout_resize=function() return false end}})\n"
    " __mouse_release=require('lib.mouse_release').new(require('lib.bind'))\n"
    " __mouse_release.bind('mouse:272',__target_router.start_drag)\n"
    " __mouse_release.bind('mouse:273',function() return __target_router.start_resize(false) end)\n"
    "end\n"
    "if hl.plugin.window_interaction_hooks then __target_router_init() end\n"
)
proc = fixture = pointer_client = None
signature = None
checks = []
log = (root / "compositor.log").open("wb")
fixture_log = (root / "fixture.log").open("wb")


def private():
    assert proc and proc.poll() is None, "nested compositor stopped"
    assert signature and signature != primary_signature and root != primary_runtime
    directory = root / "hypr" / signature
    assert (directory / ".socket.sock").is_socket()
    lock = (directory / "hyprland.lock").read_text().splitlines()
    assert str(proc.pid) in lock, (proc.pid, lock)


def call(*args):
    private()
    assert signature is not None
    result = subprocess.run([str(bins / "hyprctl"), "-i", signature, *args],
                            env={**env, "HYPRLAND_INSTANCE_SIGNATURE": signature},
                            capture_output=True, text=True, timeout=8)
    with (root / "commands.jsonl").open("a") as record:
        record.write(json.dumps({"args": args, "exit": result.returncode,
                                 "stdout": result.stdout, "stderr": result.stderr}) + "\n")
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    assert "stack traceback" not in result.stdout, result.stdout
    assert not result.stdout.startswith("Error"), result.stdout
    return result.stdout.strip()


def lua(expression):
    return call("eval", expression)


def dispatch(expression):
    return call("dispatch", expression)


def clients():
    return json.loads(call("-j", "clients"))


def wait(predicate, description):
    assert proc is not None
    for _ in range(100):
        if predicate():
            return
        assert proc.poll() is None and (not fixture or fixture.poll() is None)
        time.sleep(0.025)
    raise AssertionError(description)


def window(title):
    found = []
    def mapped():
        found[:] = [w for w in clients() if w["title"] == title]
        return len(found) == 1
    wait(mapped, "window did not map: " + title)
    return found[0]


def command(**options):
    private()
    assert fixture is not None and fixture.stdin is not None
    fixture.stdin.write(json.dumps(options) + "\n")
    fixture.stdin.flush()


def focus(title):
    dispatch(f"hl.dsp.focus({{window='address:{window(title)['address']}'}})")


def pointer_command(message):
    private()
    assert pointer_client and pointer_client.poll() is None and pointer_client.stdin and pointer_client.stdout
    pointer_client.stdin.write(message + "\n")
    pointer_client.stdin.flush()
    assert select.select([pointer_client.stdout], [], [], 3)[0], "pointer ACK timeout"
    assert pointer_client.stdout.readline().strip() == "ok"


def point(x, y):
    monitors = json.loads(call("-j", "monitors"))
    assert len(monitors) == 1 and monitors[0]["scale"] == 1 and monitors[0]["transform"] == 0
    # The host tiles/resizes the nested Wayland surface; configured mode is not its input extent.
    width, height = monitors[0]["width"], monitors[0]["height"]
    x, y = round(x), round(y)
    pointer_command(f"M {x} {y} {width} {height}")
    actual = [int(v.strip()) for v in call("cursorpos").strip().split(",")]
    assert abs(actual[0] - x) <= 1 and abs(actual[1] - y) <= 1, (actual, (x, y), (width, height))
    time.sleep(0.05)


def center(title):
    w = window(title)
    point(w["at"][0] + w["size"][0] / 2, w["at"][1] + w["size"][1] / 2)


def float_at(title, x, y):
    focus(title)
    w = window(title)
    if not w["floating"]:
        dispatch(f"hl.dsp.window.float({{window='address:{w['address']}'}})")
    dispatch(f"hl.dsp.window.resize({{window='address:{w['address']}',x=350,y=250,relative=false}})")
    dispatch(f"hl.dsp.window.move({{window='address:{w['address']}',x={x},y={y},relative=false}})")
    time.sleep(0.1)


def events():
    return events_path.read_text().splitlines() if events_path.exists() else []


def gesture(button=272, close_target=False):
    focus("A")
    center("PiP")
    lua("__gesture_probe=assert(__adapter.capture_at_cursor());assert(__gesture_probe:resolve().title=='PiP')")
    baseline = len(events())
    lua("__saved_get_windows=hl.get_windows;hl.get_windows=function() error('pointer router enumerated windows') end")
    pointer_command(f"B {button} 1")
    wait(lambda: len(events()) > baseline, "pointer action did not start")
    w = window("PiP")
    point(w["at"][0] + w["size"][0] / 2 + 30, w["at"][1] + w["size"][1] / 2 + 20)
    if close_target:
        command(action="close", title="PiP")
        wait(lambda: not any(w["title"] == "PiP" for w in clients()), "target did not close")
    focus("A")
    pointer_command(f"B {button} 0")
    time.sleep(0.1)
    lua("hl.get_windows=__saved_get_windows")
    if close_target:
        lua("assert(__gesture_probe:resolve()==nil)")
    else:
        current = window("PiP")
        lua(f"local w=assert(__gesture_probe:resolve());assert(w.floating and w.pinned);assert(w.at.x=={current['at'][0]} and w.at.y=={current['at'][1]});assert(w.size.x=={current['size'][0]} and w.size.y=={current['size'][1]})")
    result = events()[baseline:]
    action = "drag" if button == 272 else "resize"
    assert f"start_{action}|PiP" in result, result
    assert f"finish_{action}|{'nil' if close_target else 'PiP'}" in result, result
    assert not call("configerrors"), call("configerrors")


try:
    proc = subprocess.Popen([str(bins / "Hyprland"), "--config", str(config)],
                            env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(100):
        assert proc.poll() is None, "nested compositor exited during startup"
        sockets = list((root / "hypr").glob("*/.socket.sock"))
        if len(sockets) == 1 and (sockets[0].parent / "hyprland.lock").exists():
            signature = sockets[0].parent.name
            break
        time.sleep(0.1)
    private()
    def instance_ready():
        assert proc is not None
        try:
            instances = json.loads(call("-j", "instances"))
        except json.JSONDecodeError:
            return False
        return any(i["instance"] == signature and i["pid"] == proc.pid for i in instances)
    wait(instance_ready, "private instance PID metadata did not become ready")
    call("reload")
    lua("assert(require('plugins.window_interaction_hooks').enabled);assert(__target_router)")
    assert not call("configerrors"), call("configerrors")
    api = "hl.plugin.window_interaction_hooks"
    lua(f"assert({api}.supports_target_handles())")
    sockets = [p for p in root.glob("wayland-*") if p.is_socket()]
    assert len(sockets) == 1
    client_env = {**env, "WAYLAND_DISPLAY": str(sockets[0]), "GDK_BACKEND": "wayland", "TEST_GTK_LIBRARY": str(gtk)}
    assert signature is not None
    # Disable only the host-forwarded mice inside this private compositor.
    parent_mice = json.loads(call("-j", "devices"))["mice"]
    with config.open("a") as f:
        for mouse in parent_mice:
            f.write(f"hl.device({{name={json.dumps(mouse['name'])},enabled=false}})\n")
    call("reload")
    assert not call("configerrors"), call("configerrors")
    pointer_client = subprocess.Popen([str(virtual_pointer)],
        env={**client_env, "TEST_PRIVATE_SIGNATURE": signature, "TEST_PRIVATE_PID": str(proc.pid)},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=fixture_log, text=True)
    assert pointer_client.stdout is not None
    assert select.select([pointer_client.stdout], [], [], 3)[0]
    assert pointer_client.stdout.readline().strip() == "ready"
    fixture = subprocess.Popen(["python3", str(Path(__file__).with_name("transient_placement_client.py"))],
                               env=client_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=fixture_log, text=True)
    assert fixture.stdout is not None
    assert select.select([fixture.stdout], [], [], 5)[0]
    assert fixture.stdout.readline().strip() == "ready"
    for title in ("A", "B", "PiP"):
        command(action="open", title=title, width=300, height=200)
        window(title)
    focus("A")
    center("B")
    lua("__adapter=require('plugins.window_interaction_hooks');__held=assert(__adapter.capture_at_cursor());assert(__held.window.title=='B','actual='..__held.window.title..' cursor='..hl.get_cursor_pos().x..','..hl.get_cursor_pos().y)")
    time.sleep(0.5)
    focus("A")
    lua("assert(__held:resolve().title=='B')")
    checks.append("cursor target differs from focus; retained handle keeps exact identity")

    float_at("B", 400, 250)
    float_at("PiP", 450, 300)
    center("PiP")
    focus("A")
    lua("assert(__adapter.capture_at_cursor().window.title=='PiP')")
    checks.append("native hit-test selects overlapping floating window above tiled windows")
    focus("PiP")
    dispatch("hl.dsp.window.pin()")
    dispatch("hl.dsp.focus({workspace='2'})")
    center("PiP")
    lua("assert(__adapter.capture_at_cursor().window.title=='PiP')")
    dispatch("hl.dsp.focus({workspace='1'})")
    checks.append("pinned window remains hittable across workspace switch")

    focus("A")
    point(1, 1)
    lua("assert(__adapter.capture_at_cursor()==nil);__fallback=assert(__adapter.capture_window(hl.get_active_window()));assert(__fallback.window.title=='A')")
    checks.append("empty-space hit-test returns nil; explicit active-window fallback captures exact window")
    lua(f"assert(not pcall({api}.capture_window,'bad'));assert(not pcall({api}.resolve_target,{{}},'bad'));assert(not pcall({api}.resolve_target,__fallback.window,{{}}));assert({api}.resolve_target(__fallback.window,'stale')==nil)")
    checks.append("malformed native inputs rejected; wrong epoch cannot resolve")

    gesture()
    gesture(273)
    checks.append("real pointer-button drag and resize retain PiP identity after focus changes without Lua enumeration")
    center("PiP")
    lua("__closed=assert(__adapter.capture_at_cursor())")
    gesture(close_target=True)
    lua("assert(__closed:resolve()==nil)")
    command(action="open", title="PiP", width=300, height=200)
    window("PiP")
    lua("assert(__closed:resolve()==nil)")
    checks.append("closure cancels PiP finish; replacement with same title cannot revive old handle")

    center("B")
    epoch_path = root / "pre-reload-epoch"
    lua(f"local t=assert(__adapter.capture_at_cursor());assert(t.window.title=='B');local f=assert(io.open({json.dumps(str(epoch_path))},'w'));f:write(t.epoch);f:close()")
    old_epoch = epoch_path.read_text()
    call("reload")
    center("B")
    lua(f"__adapter=require('plugins.window_interaction_hooks');assert(__adapter.enabled);local t=assert(__adapter.capture_at_cursor());assert(t:resolve().title=='B');assert({api}.resolve_target(t.window,{json.dumps(old_epoch)})==nil)")
    checks.append("reload replaces Lua state and rejects saved old epoch; fresh capture works")
    unload_epoch_path = root / "pre-unload-epoch"
    lua(f"__before_unload=assert(__adapter.capture_at_cursor());__core_window=__before_unload.window;local f=assert(io.open({json.dumps(str(unload_epoch_path))},'w'));f:write(__before_unload.epoch);f:close();hl.on('config.unload',function() if not hl.plugin.window_interaction_hooks then assert(__before_unload:resolve()==nil);assert(__core_window.title=='B');__before_unload=nil;__core_window=nil;collectgarbage('collect');__target_log('unload-core-GC-safe') end end)")
    unload_epoch = unload_epoch_path.read_text()
    call("plugin", "unload", str(plugin))
    wait(lambda: "unload-core-GC-safe" in events(), "retained core userdata was not checked before Lua teardown")
    # The declarative load queues the plugin again during the automatic reload.
    call("reload")
    center("B")
    lua(f"__adapter=require('plugins.window_interaction_hooks');assert(__adapter.enabled);local t=assert(__adapter.capture_at_cursor());assert(t:resolve().title=='B');assert({api}.resolve_target(t.window,{json.dumps(unload_epoch)})==nil);collectgarbage('collect')")
    checks.append("unload callback safely resolves/collects retained core userdata; reloaded plugin rejects old epoch")
    assert not call("configerrors"), call("configerrors")
    results = {"pid": proc.pid, "plugin": str(plugin), "plugin_sha256": hashlib.sha256(plugin.read_bytes()).hexdigest(),
               "checks": checks, "version": call("version").splitlines()[0], "plugins": json.loads(call("-j", "plugin", "list"))}
    (root / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print("PASS", checks, flush=True)
finally:
    for child in (pointer_client, fixture, proc):
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
    (root / "run-summary.json").write_text(json.dumps({"checks": checks, "pid": proc.pid if proc else None,
        "compositor_exit": proc.returncode if proc else None, "compositor_stopped": bool(proc and proc.poll() is not None)}, indent=2) + "\n")
    fixture_log.close()
    log.close()
