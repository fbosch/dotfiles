from pathlib import Path

changes = {}
def edit(path, transform):
    p = Path(path)
    text = p.read_text()
    updated = transform(text)
    assert updated != text, f'No change: {path}'
    assert text.count('test(') == updated.count('test('), f'Test count changed: {path}'
    changes[p] = updated

def replace_once(text, old, new):
    assert text.count(old) == 1, f'Expected one occurrence: {old[:100]!r}'
    return text.replace(old, new, 1)

def replace_between(text, start, end, replacement):
    assert text.count(start) == text.count(end) == 1, f'Ambiguous boundary: {start}'
    a, b = text.index(start), text.index(end)
    assert a < b
    return text[:a] + replacement.rstrip() + '\n\n' + text[b:]

edit('.pi/agent/extensions/neovim/__tests__/channel.test.ts', lambda t: replace_once(t,
    'message: "The Neovim context is stale; refresh context and retry read_buffer",',
    'message: "The selected source no longer matches this request. Submit a new Ask before reading it.",'))
edit('.pi/agent/extensions/neovim/__tests__/channel.integration.test.ts', lambda t: replace_once(t,
    '\'vim.bo[excluded].filetype = "opencode"\',',
    '"vim.b[excluded].is_pi_terminal = true",'))

edit('.config/ags/scripts/tests/gjs/ai-pointer-process-lifecycle.case.ts', lambda t: replace_between(t,
    'test("AI Pointer answer and preflight cancellation settle owned processes",',
    'test("AI Pointer capture cancellation force-exits and removes partial output",',
    '''test("AI Pointer cancelled answer and preflight never acquire processes", async () => {
\tconst cancellable = new Gio.Cancellable();
\tcancellable.cancel();
\tconst observations: ProcessObservation[] = [];
\tconst deltas: string[] = [];
\tconst answer = await requestAnswer(
\t\t{
\t\t\trequestId: "cancel-answer",
\t\t\tprompt: "Question",
\t\t\tattachment: { path: "/unread", sha256: "a".repeat(64) },
\t\t\ttimeoutSeconds: 5,
\t\t},
\t\tcancellable,
\t\t(process) => observations.push(process),
\t\t(text) => deltas.push(text),
\t);
\tassert(answer.kind === "cancelled", "answer cancellation did not reach the caller");
\tconst preflight = await preflightAnswer(cancellable, (process) => observations.push(process));
\tassert(preflight.kind === "failed" && preflight.code === "cancelled", "preflight cancellation did not reach the caller");
\tassert(observations.length === 0, "cancelled answer acquired process ownership");
\tassert(deltas.length === 0, "cancelled answer emitted output");
});'''))

def workflow_cases(t):
    t = replace_between(t,
        'test("AI Pointer rejects missing and malformed preflight helpers",',
        'test("AI Pointer preflight failure does not block selection rendering",',
        '''test("AI Pointer preflight reports the unavailable backend without starting a helper", async () => {
\tconst observations: Array<Gio.Subprocess | null> = [];
\tconst result = await preflightAnswer(new Gio.Cancellable(), (process) => observations.push(process));
\tassert(result.kind === "failed" && result.code === "backend_unavailable", "preflight did not report the unavailable backend");
\tassert(observations.length === 0, "unavailable preflight acquired a process");
});''')
    return replace_between(t,
        'test("AI Pointer bounds a helper that ignores cooperative cancellation",',
        'test("AI Pointer fails closed when lock state is unavailable",',
        '''test("AI Pointer reports the unavailable answer backend without reading or spawning", async () => {
\tconst observations: Array<Gio.Subprocess | null> = [];
\tconst deltas: string[] = [];
\tconst result = await requestAnswer(
\t\t{
\t\t\trequestId: "unavailable-answer",
\t\t\tprompt: "Question",
\t\t\tattachment: { path: "/unread", sha256: "a".repeat(64) },
\t\t\ttimeoutSeconds: 5,
\t\t},
\t\tnew Gio.Cancellable(),
\t\t(process) => observations.push(process),
\t\t(text) => deltas.push(text),
\t);
\tassert(result.kind === "failed" && result.code === "backend_unavailable", "answer did not report the unavailable backend");
\tassert(observations.length === 0, "unavailable answer acquired a process");
\tassert(deltas.length === 1 && deltas[0] === "", "unavailable answer did not clear stale output");
});''')
edit('.config/ags/scripts/tests/gjs/ai-pointer-workflow.case.tsx', workflow_cases)

edit('devenv.nix', lambda t: replace_between(t,
    '    "test:ags-gjs".exec =',
    '    "test:runtime-shell".exec =',
    '''    "test:ags-gjs".exec = ''
      set -euo pipefail
      test_home="$(mktemp -d "$DEVENV_STATE/ags-home.XXXXXX")"
      trap 'rm -rf "$test_home"' EXIT
      export HOME="$test_home"
      export XDG_CONFIG_HOME="$HOME/.config"
      export XDG_CACHE_HOME="$HOME/.cache"
      export XDG_STATE_HOME="$HOME/.local/state"
      mkdir -p "$XDG_CONFIG_HOME/waybar"
      cp .config/waybar/config "$XDG_CONFIG_HOME/waybar/config"
      # Keep compositor queries deterministic and away from an inherited desktop session.
      export PATH="$PWD/tests/fixtures/ags/bin:$PATH"
      unset HYPRLAND_INSTANCE_SIGNATURE WAYLAND_DISPLAY
      cd .config/ags
      # The view tests exercise a 480px surface inside the lower half of this display.
      GDK_BACKEND=x11 GSK_RENDERER=cairo GTK_A11Y=none \\
        timeout --foreground 180s dbus-run-session \\
        --config-file=${pkgs.dbus}/share/dbus-1/session.conf -- \\
        xvfb-run -a -s "-screen 0 1920x1440x24" bun run test:gjs
    '';'''))

def waybar(t):
    t = replace_between(t, 'async function runChild(mode: string): Promise<void> {',
        'async function runControlInChild(', '''async function runChild(mode: string): Promise<void> {
\tlet failures = 0;
\tconst originalError = console.error;
\tconsole.error = (...args: Parameters<typeof console.error>) => {
\t\tif (args[0] === "Waybar control request failed:") failures++;
\t\toriginalError(...args);
\t};
\ttry {
\t\tshowWaybar();
\t\tif (mode === "success") {
\t\t\tawait waitFor(() => Gio.File.new_for_path(`${GLib.get_home_dir()}/request`).query_exists(null));
\t\t} else {
\t\t\tawait waitFor(() => failures > 0);
\t\t}
\t\t// Count calls, not GJS's formatted stack traces, which can repeat the message.
\t\tprint(`WAYBAR_CONTROL_RESULT ${failures}`);
\t} finally {
\t\tconsole.error = originalError;
\t}
}''')
    assert t.count('countFailures(result.stderr)') == 3
    t = t.replace('countFailures(result.stderr)', 'countFailures(result)')
    return replace_between(t, 'function countFailures(', 'async function waitFor(', r'''function countFailures(output: ChildOutput): number {
\tconst markers = [...`${output.stdout}\n${output.stderr}`.matchAll(/^WAYBAR_CONTROL_RESULT (\d+)$/gm)];
\tassert(markers.length === 1, "child did not report exactly one failure count");
\treturn Number(markers[0][1]);
}'''.replace(r'\t', '\t'))
edit('.config/ags/services/__tests__/waybar-control.case.ts', waybar)

fixture = Path('tests/fixtures/ags/bin/hyprctl')
assert not fixture.exists()
fixture_text = '''#!/usr/bin/env python3
"""Fixed compositor responses for the isolated AGS test environment."""
import json
import sys

clients = [
    {"address": "0x1", "mapped": True, "hidden": False, "class": "fixture-one",
     "initialClass": "fixture-one", "title": "Fixture One", "initialTitle": "Fixture One",
     "workspace": {"id": 1, "name": "1"}, "focusHistoryID": 0, "pid": 101,
     "xwayland": False, "at": [0, 0], "size": [640, 480], "floating": False},
    {"address": "0x2", "mapped": True, "hidden": False, "class": "fixture-two",
     "initialClass": "fixture-two", "title": "Fixture Two", "initialTitle": "Fixture Two",
     "workspace": {"id": 1, "name": "1"}, "focusHistoryID": 1, "pid": 102,
     "xwayland": False, "at": [640, 0], "size": [640, 480], "floating": False},
]
if sys.argv[1:] == ["clients", "-j"]:
    print(json.dumps(clients))
elif sys.argv[1:] == ["activewindow", "-j"]:
    print(json.dumps(clients[0]))
else:
    print("Unsupported AGS test compositor request: " + repr(sys.argv[1:]), file=sys.stderr)
    sys.exit(2)
'''
compile(fixture_text, str(fixture), 'exec')
for path, text in changes.items():
    path.write_text(text)
fixture.parent.mkdir(parents=True, exist_ok=True)
fixture.write_text(fixture_text)
fixture.chmod(0o755)
print('Updated only these paths:')
print('\n'.join(str(p) for p in [*changes, fixture]))
