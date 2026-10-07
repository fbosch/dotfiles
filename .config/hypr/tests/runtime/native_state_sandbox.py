#!/usr/bin/env python3
"""Opt-in native persistence integration test. All mutations target a private nested compositor.

Set TEST_HYPRLAND_DIR to the matching compositor bin directory and TEST_PLUGIN to
its built plugin library. Run inside the repo's devenv shell for LuaSocket.
"""
import json
import os
import socket
import subprocess as sp
import tempfile
import time
from pathlib import Path


root = Path(tempfile.mkdtemp(prefix='pps.'))
print('ARTIFACTS', root, flush=True)
primary = os.environ['HYPRLAND_INSTANCE_SIGNATURE']
parent = Path(os.environ['XDG_RUNTIME_DIR']) / os.environ['WAYLAND_DISPLAY']
hypr = str(Path(os.environ['TEST_HYPRLAND_DIR']).resolve()) + '/'
plugin = str(Path(os.environ['TEST_PLUGIN']).resolve())
for d in ['home', 'config', 'state', 'cache', 'data']:
    (root / d).mkdir(mode=448)
env = {'PATH': os.environ['PATH'], 'HOME': str(root / 'home'), 'XDG_RUNTIME_DIR': str(root), 'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_STATE_HOME': str(root / 'state'), 'XDG_CACHE_HOME': str(root / 'cache'), 'XDG_DATA_HOME': str(root / 'data'), 'WAYLAND_DISPLAY': str(parent), 'AQ_BACKEND': 'wayland', 'HYPRLAND_NO_SD_VARS': '1', 'HYPRLAND_NO_SD_TARGET': '1', 'HYPRLAND_NO_SD_NOTIFY': '1', 'NO_SD_TARGET': '1', 'NO_SD_NOTIFY': '1', 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=' + str(root / 'no-bus')}
env.update(HYPR_PERSISTENT_POSITION_ENABLED='1', HYPR_PERSISTENT_POSITION_PLUGIN=plugin)
for name in ('LUA_PATH', 'LUA_CPATH'):
    if os.environ.get(name):
        env[name] = os.environ[name]
config = root / 'config/hyprland.lua'
config.write_text("hl.monitor({output='',mode='preferred',position='0x0',scale=1})\nhl.config({animations={enabled=false},misc={new_float_force_onscreen=false}})\nhl.window_rule({match={class='^pp-size-probe$'},float=true,size='200 100',fullscreen=true})\nhl.window_rule({match={class='^pp-pip$'},float=true,size='300 170',move='monitor_w-window_w-15 monitor_h-window_h-15'})\nhl.window_rule({match={class='^nemo$'},float=true})\n")
log = (root / 'compositor.log').open('wb')
proc = None
sig = None

def call(*args):
    assert sig and sig != primary
    e = {**env, 'HYPRLAND_INSTANCE_SIGNATURE': sig}
    r = sp.run([hypr + 'hyprctl', '-i', sig, *args], env=e, text=True, capture_output=True, timeout=8)
    with (root / 'commands.log').open('a') as f:
        f.write(repr(args) + '\n' + r.stdout + r.stderr)
    assert r.returncode == 0, (args, r.stdout, r.stderr)
    return r.stdout.strip()

def lua(s):
    return call('eval', s)

def clients():
    return json.loads(call('-j', 'clients'))

def wait_client(klass):
    for _ in range(60):
        found = [w for w in clients() if w['class'] == klass]
        if found:
            time.sleep(0.2)
            return next(w for w in clients() if w['class'] == klass)
        time.sleep(0.1)
    raise AssertionError('missing client ' + klass)
try:
    proc = sp.Popen([hypr + 'Hyprland', '--config', str(config)], env=env, stdout=log, stderr=sp.STDOUT, start_new_session=True)
    for _ in range(100):
        assert proc.poll() is None, 'compositor exited'
        dirs = list((root / 'hypr').iterdir()) if (root / 'hypr').exists() else []
        if dirs and (dirs[0] / '.socket.sock').exists():
            sig = dirs[0].name
            break
        time.sleep(0.1)
    assert sig and sig != primary
    ins = json.loads(sp.check_output([hypr + 'hyprctl', '-j', 'instances'], env={**env, 'HYPRLAND_INSTANCE_SIGNATURE': sig}))
    assert any(i['instance'] == sig and i['pid'] == proc.pid for i in ins)
    print('SANDBOX', sig, 'PID', proc.pid, flush=True)
    assert not call('configerrors')
    print('LOAD', call('plugin', 'load', plugin), flush=True)
    state = str(root / 'state/persistent-position.state')
    Path(state).write_text('persistent-position-v2\n' + b'probe'.hex() + '\t' + b'WAYLAND-1'.hex() + '\t20\t30\t320\t180\t1\t-\t-\n')
    lua('assert(hl.plugin.persistent_position.import_legacy == nil); assert(hl.plugin.persistent_position.configure(' + json.dumps(state) + ',{{id="probe",matcher="match:class",pattern="^pp-size-probe$"}}))')
    for backend, cmd in [('wayland', 'foot --config=/dev/null --app-id=pp-size-probe --title=probe sleep 600'), ('x11', 'kitty --config=/dev/null -o linux_display_server=x11 --class=pp-size-probe --title=probe sleep 600')]:
        call('dispatch', 'hl.dsp.exec_cmd(' + json.dumps(cmd) + ')')
        w = wait_client('pp-size-probe')
        print(backend, json.dumps(w), flush=True)
        assert w['at'] == [20, 30] and w['size'] == [320, 180] and (w['fullscreen'] == 0), w
        address = json.dumps('address:' + w['address'])
        call('dispatch', 'hl.dsp.window.fullscreen({window=' + address + ', mode="fullscreen"})')
        time.sleep(0.2)
        assert next(w for w in clients() if w['class'] == 'pp-size-probe')['fullscreen'] == 2
        call('dispatch', 'hl.dsp.window.kill({window=' + address + '})')
        time.sleep(0.3)
    lua('assert(hl.plugin.persistent_position.configure(' + json.dumps(state) + ',{{id="pip",matcher="match:class",pattern="^pp-pip$",per_monitor=false,geometry_authority="pip",restore_monitor=true,restore_size=false,force_windowed=false}}))')
    for corner in ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'free']:
        payload = '{kind="corner",corner=' + json.dumps(corner) + ',target_monitor="WAYLAND-1",width=800,height=600}' if corner != 'free' else '{kind="free",target_monitor="WAYLAND-1",x=33,y=44}'
        lua('assert(hl.plugin.persistent_position.accept_pip_placement(' + payload + '))')
        call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=pp-pip --title=pip sleep 600")')
        w = wait_client('pp-pip')
        m = json.loads(call('-j', 'monitors'))[0]
        W, H = (m['width'] / m['scale'], m['height'] / m['scale'])
        expected = [33, 44] if corner == 'free' else [15 if corner.endswith('left') else max(15, W - 300 - 15), 15 if corner.startswith('top') else max(15, H - 170 - 15)]
        assert w['size'] == [300, 170] and all(abs(a - b) <= 1 for a, b in zip(w['at'], expected, strict=True)), (corner, w, expected)
        tags = [t.rstrip('*') for t in w['tags'] if t.startswith('pip-')]
        assert tags == ([] if corner == 'free' else ['pip-' + corner]), (corner, tags)
        print('PASS PiP', corner, w['at'], w['size'], tags, flush=True)
        call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
        time.sleep(0.2)
    print('CREATE SECOND OUTPUT', call('output', 'create', 'headless', 'PIP-TEST'), flush=True)
    lua('hl.monitor({output="PIP-TEST",mode="800x600@60",position="2500x0",scale=1})')
    time.sleep(0.3)
    monitors = json.loads(call('-j', 'monitors'))
    target = next(m for m in monitors if m['name'] == 'PIP-TEST')
    lua('assert(hl.plugin.persistent_position.accept_pip_placement({kind="corner",corner="top-left",target_monitor="PIP-TEST"}))')
    call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=pp-pip --title=pip sleep 600")')
    w = wait_client('pp-pip')
    assert w['monitor'] == target['id'] and w['at'] == [target['x'] + 15, target['y'] + 15], (w, target)
    print('PASS PiP saved-monitor routing', w['at'], w['monitor'], flush=True)
    call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
    call('output', 'remove', 'PIP-TEST')
    time.sleep(0.3)
    call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=pp-pip --title=pip sleep 600")')
    w = wait_client('pp-pip')
    assert w['monitor'] != target['id'], w
    print('PASS missing monitor fallback', w['monitor'], flush=True)
    call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
    legacy = root / 'home/.config/hypr/rules/window-state.lua'
    legacy.parent.mkdir(parents=True)
    legacy.write_text('error("retired state must not be read")')
    native = root / 'state/hyprland/persistent-position.state'
    native.parent.mkdir(parents=True)
    native.write_text('persistent-position-v2\n' + b'nemo-main'.hex() + '\t' + b'WAYLAND-1'.hex() + '\t40\t50\t360\t210\t1\t-\t-\n')
    repo = str(Path(__file__).resolve().parents[4])
    adapter_expression = 'package.path=' + json.dumps(repo + '/.config/hypr/?.lua;' + repo + '/.config/hypr/?/init.lua;') + '..package.path; package.loaded["plugins.persistent_position"]=nil; local api=hl.plugin.persistent_position; local configure=api.configure; local configured=false; api.configure=function(path,selectors) assert(#selectors==19); local ok,err=configure(path,selectors); configured=ok==true; return ok,err end; local ok,result=pcall(require,"plugins.persistent_position"); api.configure=configure; assert(ok,result); assert(result.native_state and configured)'
    lua(adapter_expression)
    assert not (Path(repo) / '.config/hypr/runtime/windows/daemons/window-state/window-state.sh').exists()
    before = legacy.read_bytes()
    observer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    observer.connect(str(root / 'hypr' / sig / '.socket2.sock'))
    observer.setblocking(False)
    call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=nemo sleep 600")')
    w = wait_client('nemo')
    assert w['at'] == [40, 50] and w['size'] == [360, 210], w
    call('dispatch', 'hl.dsp.focus({window=' + json.dumps('address:' + w['address']) + '})')
    call('dispatch', 'hl.dsp.window.resize({x=380,y=230,window=' + json.dumps('address:' + w['address']) + '})')
    lua('assert(hl.plugin.persistent_position.capture_focused())')
    time.sleep(0.3)
    call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
    time.sleep(0.2)
    call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=nemo sleep 600")')
    w = wait_client('nemo')
    assert w['size'] == [380, 230], w
    assert legacy.read_bytes() == before, 'legacy rules rewritten'
    events = b''
    while True:
        try:
            chunk = observer.recv(65536)
            if not chunk:
                break
            events += chunk
        except BlockingIOError:
            break
    assert b'configreloaded>>' not in events, events
    observer.close()
    call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
    print('PASS production adapter: v2-only,19 selectors,daemon retirement,size roundtrip,no rule write/no reload', flush=True)
    print('UNLOAD', call('plugin', 'unload', plugin), flush=True)
    call('plugin', 'load', plugin)
    lua(adapter_expression)
    call('dispatch', 'hl.dsp.exec_cmd("foot --config=/dev/null --app-id=nemo sleep 600")')
    w = wait_client('nemo')
    assert w['size'] == [380, 230], w
    call('dispatch', 'hl.dsp.window.kill({window=' + json.dumps('address:' + w['address']) + '})')
    call('plugin', 'unload', plugin)
    print('PASS v2 durable restore after plugin reload; retired state ignored', flush=True)
    assert proc.poll() is None
    print('PASS size precedence, initial windowed state, later fullscreen request, unload', flush=True)
finally:
    if sig and proc and (proc.poll() is None):
        try:
            call('dispatch', 'hl.dsp.exit()')
            time.sleep(0.3)
        except Exception as e:
            print('exit note', e, flush=True)
    for child in Path('/proc').iterdir():
        if child.name.isdigit():
            try:
                argv = (child / 'cmdline').read_bytes().split(b'\x00')
                if str(config).encode() in argv and any(b'Hyprland' in a for a in argv):
                    os.kill(int(child.name), 9)
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except sp.TimeoutExpired:
            proc.kill()
            proc.wait()
    log.close()
    print('PRIMARY', primary, 'sandbox_stopped', proc is None or proc.poll() is not None, flush=True)
