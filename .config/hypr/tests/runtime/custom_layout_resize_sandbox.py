#!/usr/bin/env python3
"""Exercise native custom-layout resize only inside a verified nested Hyprland."""
import json
import os
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def require_path(name, *, directory=False, executable=False):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"required environment variable {name} is unset")
    path = Path(value).expanduser().resolve()
    valid = path.is_dir() if directory else path.is_file()
    if not valid or (executable and not os.access(path, os.X_OK)):
        raise SystemExit(f"{name} is not a usable {'directory' if directory else 'file'}: {path}")
    return path


bins = require_path("TEST_HYPRLAND_DIR", directory=True)
gtk = require_path("TEST_GTK_LIBRARY")
plugin = require_path("TEST_RESIZE_PLUGIN")
virtual_pointer = require_path("TEST_VIRTUAL_POINTER", executable=True)
config_root = require_path("TEST_CONFIG_ROOT", directory=True)
if plugin.name != "libcustom-layout-resize.so":
    raise SystemExit(f"TEST_RESIZE_PLUGIN must name libcustom-layout-resize.so: {plugin}")
if config_root == Path(__file__).resolve().parents[2]:
    raise SystemExit("TEST_CONFIG_ROOT must be the verified staged config, not this live source tree")
for relative in (
    "lib/window/custom_layout.lua",
    "layouts/ultrawide_master.lua",
    "layouts/portrait_rows.lua",
):
    if not (config_root / relative).is_file():
        raise SystemExit(f"staged config is missing {relative}: {config_root}")
for name in ("Hyprland", "hyprctl"):
    if not (bins / name).is_file() or not os.access(bins / name, os.X_OK):
        raise SystemExit(f"TEST_HYPRLAND_DIR is missing executable {name}: {bins}")

primary_signature = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
primary_runtime_value = os.environ.get("XDG_RUNTIME_DIR")
parent_display_name = os.environ.get("WAYLAND_DISPLAY")
if not primary_signature or not primary_runtime_value or not parent_display_name:
    raise SystemExit("run this opt-in sandbox from an active Wayland Hyprland session")
primary_runtime = Path(primary_runtime_value).resolve()
parent_display = Path(parent_display_name)
if not parent_display.is_absolute():
    parent_display = primary_runtime / parent_display
parent_display = parent_display.resolve()
if not parent_display.is_socket():
    raise SystemExit(f"parent Wayland socket is not available: {parent_display}")

# Hyprland appends a long signature to Unix socket paths; keep the root short.
root = Path(tempfile.mkdtemp(prefix="cr."))
root.chmod(0o700)
print("ARTIFACTS", root, flush=True)
for name in ("home", "config", "state", "cache", "data"):
    (root / name).mkdir(mode=0o700)

# The child gets only a private HOME/XDG tree and the one explicit parent socket.
env = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
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
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(root / "no-session-bus"),
    "HYPR_CUSTOM_LAYOUT_RESIZE_PLUGIN": str(plugin),
}
config_path = root / "config/hyprland.lua"
layout_events_path = root / "layout-events.log"
config_path.write_text(
    "hl.monitor({output='WAYLAND-1',mode='1600x900@60',position='0x0',scale=1})\n"
    "hl.config({debug={enable_stdout_logs=true,disable_logs=false},animations={enabled=true},input={follow_mouse=0},general={gaps_in=0,gaps_out=0,border_size=0}})\n"
    f"package.path={json.dumps(str(config_root) + '/?.lua;' + str(config_root) + '/?/init.lua;')}..package.path\n"
    "package.loaded['lib.monitor_role']={ultrawide='ultrawide',portrait='portrait',\n"
    " for_monitor=function(m) return m and (m.name=='WAYLAND-1' and 'ultrawide' or 'portrait') end,\n"
    " for_window=function(w) return w and w.monitor and (w.monitor.name=='WAYLAND-1' and 'ultrawide' or 'portrait') end,\n"
    " name_for=function(r) return r=='ultrawide' and 'WAYLAND-1' or 'WAYLAND-2' end}\n"
    f"local function log(s) local f=assert(io.open({json.dumps(str(layout_events_path))},'a')); f:write(s,'\\n'); f:close() end\n"
    "local register_layout=hl.layout.register\n"
    "hl.layout.register=function(name,definition)\n"
    " local callback=definition.layout_msg\n"
    " if callback then definition.layout_msg=function(ctx,msg)\n"
    "  local ids={} local workspace='?'\n"
    "  for _,target in ipairs(ctx.targets or {}) do\n"
    "   local w=target.window or target\n"
    "   ids[#ids+1]=tostring(w.address or w.id or '?')\n"
    "   if workspace=='?' and w.workspace then workspace=tostring(w.workspace.id or w.workspace.name or '?') end\n"
    "  end\n"
    "  log('LAYOUT|'..name..'|'..workspace..'|'..table.concat(ids,',')..'|'..tostring(msg))\n"
    "  return callback(ctx,msg)\n"
    " end end\n"
    " return register_layout(name,definition)\n"
    "end\n"
    "require('layouts.ultrawide_master'); require('layouts.portrait_rows')\n"
    "hl.workspace_rule({workspace='1',monitor='WAYLAND-1',layout='lua:ultrawide_master'})\n"
    "hl.monitor({output='WAYLAND-2',mode='900x1600@60',position='1600x0',scale=1})\n"
    "hl.workspace_rule({workspace='2',monitor='WAYLAND-2',layout='lua:portrait_rows'})\n"
    "hl.workspace_rule({workspace='3',monitor='WAYLAND-1',layout='lua:ultrawide_master'})\n"
    "require('plugins.custom_layout_resize')\n"
    "local resize_api=hl.plugin and hl.plugin.custom_layout_resize\n"
    "assert(resize_api and type(resize_api.start)=='function' and type(resize_api.stop)=='function', 'resize plugin API unavailable')\n"
    "assert(type(resize_api.supports_direct_updates)=='function' and resize_api.supports_direct_updates()==true, 'direct updates unsupported')\n"
    "local original_on=hl.on\n"
    "hl.on=function(name,callback,...)\n"
    " if name=='custom_layout_resize.command' then log('FORBIDDEN_RELAY_SUBSCRIPTION'); error('command broker must not be installed') end\n"
    " return original_on(name,callback,...)\n"
    "end\n"
    "local original_layout_dispatch=hl.dsp.layout\n"
    "hl.dsp.layout=function(message) log('RELAY|'..tostring(message)); return original_layout_dispatch(message) end\n"
    "local original_animation=hl.animation\n"
    "hl.animation=function(args) log('ANIMATION|'..tostring(args.leaf)..'|'..tostring(args.enabled)); return original_animation(args) end\n"
    "local custom_layout=require('lib.window.custom_layout')\n"
    "local window_state=require('lib.window.state')\n"
    "function __sandbox_resize_start()\n"
    " local w=window_state.active()\n"
    " local ok=w and custom_layout.start_custom_layout_resize(w) or false\n"
    " log('START|'..tostring(w and w.title or '?')..'|'..tostring(w and w.address or '?')..'|'..tostring(w and w.workspace and (w.workspace.id or w.workspace.name) or '?')..'|'..tostring(ok))\n"
    "end\n"
    "function __sandbox_resize_stop() custom_layout.stop_custom_layout_resize(); log('STOP') end\n"
)

proc: subprocess.Popen[bytes] | None = None
fixture: subprocess.Popen[str] | None = None
pointer: subprocess.Popen[str] | None = None
signature: str | None = None
log_file = (root / "compositor.log").open("wb")
fixture_log = (root / "fixture.log").open("wb")
pointer_log = (root / "pointer.log").open("wb")
checks = []
commands = []
keyboard_env: dict[str, str] | None = None
pointer_ready = False


def private_instance():
    assert proc is not None and proc.poll() is None, "nested compositor stopped"
    assert signature and signature != primary_signature, "refusing host Hyprland instance"
    assert root != primary_runtime, "nested runtime aliases parent runtime"
    assert (root / "hypr" / signature / ".socket.sock").is_socket(), "private Hyprland socket missing"


def call(*args: str) -> str:
    private_instance()
    active_signature = signature
    assert active_signature is not None
    result = subprocess.run(
        [str(bins / "hyprctl"), "-i", active_signature, *args],
        env={**env, "HYPRLAND_INSTANCE_SIGNATURE": active_signature},
        capture_output=True,
        text=True,
        timeout=8,
    )
    row = {"args": list(args), "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    commands.append(row)
    with (root / "commands.jsonl").open("a") as record:
        record.write(json.dumps(row) + "\n")
    assert result.returncode == 0, (args, result.stdout, result.stderr)
    assert "stack traceback" not in result.stdout, result.stdout
    return result.stdout.strip()


def eval_lua(expression):
    output = call("eval", expression)
    assert "stack traceback" not in output and "error:" not in output.lower(), output
    return output


def clients():
    return json.loads(call("-j", "clients"))


def monitor_map():
    return {monitor["name"]: monitor for monitor in json.loads(call("-j", "monitors"))}


def window(title, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        matches = [item for item in clients() if item["title"] == title]
        if matches:
            return matches[0]
        assert fixture is not None and fixture.poll() is None, "GTK fixture stopped"
        time.sleep(0.04)
    raise AssertionError("window did not map: " + title)


def fixture_command(**options):
    assert fixture is not None and fixture.poll() is None and fixture.stdin is not None
    fixture.stdin.write(json.dumps(options) + "\n")
    fixture.stdin.flush()


def layout_events():
    if not layout_events_path.exists():
        return []
    return layout_events_path.read_text().splitlines()


def route_rows():
    rows = []
    for line in layout_events():
        fields = line.split("|", 4)
        if len(fields) == 5 and fields[0] == "LAYOUT":
            rows.append({"layout": fields[1], "workspace": fields[2], "ids": fields[3].split(","), "message": fields[4]})
    return rows


def private_input_client():
    private_instance()
    assert keyboard_env is not None and keyboard_env["WAYLAND_DISPLAY"] != str(parent_display)
    assert pointer_ready and pointer is not None and pointer.poll() is None


def move_pointer(x, y):
    private_input_client()
    active_pointer = pointer
    assert active_pointer is not None
    assert active_pointer.stdin is not None and active_pointer.stdout is not None
    monitor_list = list(monitor_map().values())
    extent_width = max(m["x"] + m["width"] for m in monitor_list)
    extent_height = max(m["y"] + m["height"] for m in monitor_list)
    active_pointer.stdin.write(f"M {max(0, int(x))} {max(0, int(y))} {extent_width} {extent_height}\n")
    active_pointer.stdin.flush()
    ready, _, _ = select.select([active_pointer.stdout], [], [], 3)
    assert ready and active_pointer.stdout.readline().strip() == "ok", "virtual pointer motion failed"


def focus_window(item):
    call("dispatch", f"hl.dsp.focus({{window='address:{item['address']}'}})")
    active = json.loads(call("-j", "activewindow"))
    assert active.get("address") == item["address"], (active, item)


def wait_for(predicate, reason, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        private_instance()
        if predicate():
            return
        time.sleep(0.04)
    raise AssertionError(reason)


def axis_geometry(items, axis):
    coordinate = 0 if axis == "x" else 1
    extent = coordinate
    ordered = sorted(items, key=lambda item: item["at"][coordinate])
    assert len(ordered) == 2, (axis, ordered)
    return ordered, ordered[0]["at"][coordinate] + ordered[0]["size"][extent]


def begin_resize(target, axis, monitor):
    focus_window(target)
    boundary_axis = 0 if axis == "x" else 1
    orthogonal = 1 if axis == "x" else 0
    coordinate = target["at"][boundary_axis] + target["size"][boundary_axis] - 3
    other_coordinate = target["at"][orthogonal] + target["size"][orthogonal] // 2
    start = [other_coordinate, other_coordinate]
    start[boundary_axis] = coordinate
    start[orthogonal] = other_coordinate
    move_pointer(start[0], start[1])
    start_index = len(layout_events())
    # shortcut: private Lua IPC isolates routing from unreliable virtual-keyboard delivery.
    # Add keybind coverage once virtual-keyboard delivery is reliable in this fixture.
    call("eval", "__sandbox_resize_start()")
    wait_for(lambda: any(row.startswith(f"START|{target['title']}|{target['address']}|") for row in layout_events()[start_index:]),
             "private Lua resize start did not run")
    start_row = next(row for row in reversed(layout_events()[start_index:]) if row.startswith(f"START|{target['title']}|{target['address']}|"))
    assert start_row.endswith("|true"), start_row
    wait_for(lambda: any(row == "ANIMATION|windowsMove|false" for row in layout_events()),
             "custom layout did not suppress move animation")


def release_resize():
    release_index = len(layout_events())
    call("eval", "__sandbox_resize_stop()")
    wait_for(lambda: "STOP" in layout_events()[release_index:], "private resize stop did not run")


def check_axis_resize(layout_name, workspace_id, axis, target_titles):
    items = [window(title) for title in target_titles]
    ordered, initial_boundary = axis_geometry(items, axis)
    target = ordered[0]
    monitor = next(item for item in monitor_map().values() if item["id"] == target["monitor"])
    origin = monitor["x"] if axis == "x" else monitor["y"]
    span = monitor["width"] if axis == "x" else monitor["height"]
    current_rows = route_rows()
    begin_resize(target, axis, monitor)
    intermediate = origin + int(span * 0.48)
    final = origin + int(span * 0.02)  # The layout's 0.15 minimum-ratio clamp is observable here.
    point = [target["at"][0] + target["size"][0] // 2, target["at"][1] + target["size"][1] // 2]
    point[0 if axis == "x" else 1] = intermediate
    move_pointer(*point)
    wait_for(lambda: len(route_rows()) > len(current_rows), "no direct layout message arrived during pointer motion")
    messages = route_rows()[len(current_rows):]
    expected_prefix = "resize-x-at " if axis == "x" else "resize-y-at "
    assert any(row["layout"] == layout_name and row["workspace"] == str(workspace_id)
               and row["message"].startswith(expected_prefix) and target["address"] in row["message"]
               for row in messages), messages
    after_intermediate = [window(title) for title in target_titles]
    _, intermediate_boundary = axis_geometry(after_intermediate, axis)
    assert abs(intermediate_boundary - intermediate) <= 8, (intermediate_boundary, intermediate, messages)

    point[0 if axis == "x" else 1] = final
    move_pointer(*point)
    release_resize()
    after_final = [window(title) for title in target_titles]
    _, final_boundary = axis_geometry(after_final, axis)
    minimum_boundary = origin + int(span * 0.15)
    assert abs(final_boundary - minimum_boundary) <= 10, (final_boundary, minimum_boundary, after_final)
    rows = route_rows()[len(current_rows):]
    resize_messages = [row for row in rows if row["message"].startswith(expected_prefix)]
    saves = [index for index, row in enumerate(rows) if row["message"].startswith("save-resize")]
    assert resize_messages and saves and max(i for i, row in enumerate(rows) if row in resize_messages) < saves[-1], rows
    assert not any(line.startswith("RELAY|") or line == "FORBIDDEN_RELAY_SUBSCRIPTION" for line in layout_events()), layout_events()
    checks.append({
        "case": f"{layout_name} {axis} direct resize, intermediate motion, clamp, final save",
        "target": target["address"], "workspace": workspace_id,
        "initial_boundary": initial_boundary, "intermediate_boundary": intermediate_boundary,
        "final_boundary": final_boundary, "expected_clamp": minimum_boundary,
        "messages": [row["message"] for row in rows],
    })


def open_windows(workspace, titles):
    call("dispatch", f"hl.dsp.focus({{workspace='{workspace}'}})")
    for title in titles:
        fixture_command(action="open", title=title, width=240, height=180)
        window(title)
    time.sleep(0.15)


try:
    proc = subprocess.Popen(
        [str(bins / "Hyprland"), "--config", str(config_path)],
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    for _ in range(100):
        assert proc.poll() is None, "nested Hyprland exited during startup"
        sockets = list((root / "hypr").glob("*/.socket.sock"))
        if len(sockets) == 1:
            signature = sockets[0].parent.name
            break
        time.sleep(0.1)
    private_instance()
    instances = json.loads(call("-j", "instances"))
    assert any(item["instance"] == signature and item["pid"] == proc.pid for item in instances), instances
    print("NESTED", signature, "PID", proc.pid, flush=True)
    assert not call("configerrors"), "nested config has errors"

    call("output", "create", "wayland", "WAYLAND-2")
    eval_lua("hl.monitor({output='WAYLAND-2',mode='900x1600@60',position='1600x0',scale=1}); "
             "hl.workspace_rule({workspace='2',monitor='WAYLAND-2',layout='lua:portrait_rows'}); "
             "hl.workspace_rule({workspace='3',monitor='WAYLAND-1',layout='lua:ultrawide_master'})")
    time.sleep(0.35)
    monitors = monitor_map()
    assert {"WAYLAND-1", "WAYLAND-2"} <= monitors.keys(), monitors
    assert monitors["WAYLAND-1"]["width"] >= 1200 and monitors["WAYLAND-2"]["height"] >= 1200, monitors
    displays = [path for path in root.glob("wayland-*") if path.is_socket()]
    assert displays, "nested Wayland client socket missing"
    nested_display = str(displays[0])
    keyboard_env = {**env, "WAYLAND_DISPLAY": nested_display}
    client_env = {**keyboard_env, "GDK_BACKEND": "wayland", "TEST_GTK_LIBRARY": str(gtk)}
    fixture = subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("transient_placement_client.py"))],
        env=client_env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=fixture_log,
        text=True,
        start_new_session=True,
    )
    assert fixture.stdout is not None
    assert select.select([fixture.stdout], [], [], 5)[0], "GTK fixture readiness timed out"
    assert fixture.stdout.readline().strip() == "ready", "GTK fixture failed to start"

    pointer = subprocess.Popen(
        [str(virtual_pointer)],
        env=keyboard_env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=pointer_log,
        text=True,
        start_new_session=True,
    )
    assert pointer.stdout is not None
    assert select.select([pointer.stdout], [], [], 5)[0], "virtual pointer readiness timed out"
    assert pointer.stdout.readline().strip() == "ready", "virtual pointer could not connect to nested compositor"
    pointer_ready = True

    open_windows("1", ("Ultra-A", "Ultra-B"))
    open_windows("2", ("Portrait-A", "Portrait-B"))
    open_windows("3", ("Other-A", "Other-B"))
    call("dispatch", "hl.dsp.focus({workspace='1'})")

    check_axis_resize("ultrawide_master", 1, "x", ("Ultra-A", "Ultra-B"))
    check_axis_resize("portrait_rows", 2, "y", ("Portrait-A", "Portrait-B"))

    # Focus moves to a different workspace mid-session; the captured space must still receive updates.
    ultra = axis_geometry([window("Ultra-A"), window("Ultra-B")], "x")[0][0]
    other_before = [window("Other-A"), window("Other-B")]
    _, before = axis_geometry(other_before, "x")
    route_start = len(route_rows())
    begin_resize(ultra, "x", monitor_map()["WAYLAND-1"])
    active_point = [ultra["at"][0] + ultra["size"][0] // 2, ultra["at"][1] + ultra["size"][1] // 2]
    active_point[0] = monitor_map()["WAYLAND-1"]["x"] + int(monitor_map()["WAYLAND-1"]["width"] * 0.58)
    move_pointer(*active_point)
    wait_for(lambda: len(route_rows()) > route_start, "captured workspace did not receive resize update")
    call("dispatch", "hl.dsp.focus({workspace='3'})")
    after_focus = window("Other-A")
    focus_window(after_focus)
    active_point[0] = monitor_map()["WAYLAND-1"]["x"] + int(monitor_map()["WAYLAND-1"]["width"] * 0.44)
    move_pointer(*active_point)
    release_resize()
    focus_rows = route_rows()[route_start:]
    assert any(row["layout"] == "ultrawide_master" and row["workspace"] == "1"
               and "resize-x-at" in row["message"] and ultra["address"] in row["message"] for row in focus_rows), focus_rows
    assert not any(row["workspace"] == "3" and "resize-x-at" in row["message"] for row in focus_rows), focus_rows
    other_after = [window("Other-A"), window("Other-B")]
    _, other_boundary = axis_geometry(other_after, "x")
    assert other_boundary == before, (before, other_boundary)
    checks.append({"case": "focus/workspace change preserves captured workspace and target", "route": focus_rows,
                   "unrelated_boundary_before": before, "unrelated_boundary_after": other_boundary})

    # Closing a captured target while held must cancel without a late resize or save.
    call("dispatch", "hl.dsp.focus({workspace='1'})")
    close_target = axis_geometry([window("Ultra-A"), window("Ultra-B")], "x")[0][0]
    close_start = len(route_rows())
    begin_resize(close_target, "x", monitor_map()["WAYLAND-1"])
    fixture_command(action="close", title=close_target["title"])
    wait_for(lambda: not any(item["title"] == close_target["title"] for item in clients()), "captured target did not close")
    release_resize()
    close_rows = route_rows()[close_start:]
    assert not any("resize-x-at" in row["message"] or row["message"].startswith("save-resize") for row in close_rows), close_rows
    checks.append({"case": "closing captured window cancels without resize/save", "target": close_target["address"], "route": close_rows})

    # Reload while a session is active, then require a new session to resize successfully.
    fixture_command(action="open", title=close_target["title"], width=240, height=180)
    window(close_target["title"])
    time.sleep(0.15)
    fresh_items = [window("Ultra-A"), window("Ultra-B")]
    reload_target = axis_geometry(fresh_items, "x")[0][0]
    reload_start = len(route_rows())
    begin_resize(reload_target, "x", monitor_map()["WAYLAND-1"])
    call("reload")
    assert not call("configerrors"), "config errors after nested reload"
    release_resize()
    reload_rows = route_rows()[reload_start:]
    assert not any(row["message"].startswith("save-resize") for row in reload_rows), reload_rows
    fresh_items = [window("Ultra-A"), window("Ultra-B")]
    fresh_target = axis_geometry(fresh_items, "x")[0][0]
    check_axis_resize("ultrawide_master", 1, "x", ("Ultra-A", "Ultra-B"))
    checks.append({"case": "reload cancels active resize; fresh resize works", "cancel_route": reload_rows})

    results = {
        "parent_signature": primary_signature,
        "nested_signature": signature,
        "nested_pid": proc.pid,
        "plugin": str(plugin),
        "config_root": str(config_root),
        "checks": checks,
        "commands": commands,
    }
    (root / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print("PASS", json.dumps(checks, ensure_ascii=False), flush=True)
finally:
    for child in (fixture, pointer):
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=4)
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    for handle in (log_file, fixture_log, pointer_log):
        handle.close()
    summary = {
        "parent_signature": primary_signature,
        "nested_signature": signature,
        "nested_pid": proc.pid if proc is not None else None,
        "commands": commands,
        "checks": checks,
        "compositor_exit": proc.poll() if proc is not None else None,
    }
    (root / "run-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("SANDBOX_STOPPED", proc is None or proc.poll() is not None, flush=True)
