from pathlib import Path

changes = {}
def edit(name, fn):
    path = Path(name)
    original = path.read_text()
    replacement = fn(original)
    assert replacement != original, name
    changes[path] = replacement

def once(text, old, new):
    assert text.count(old) == 1, repr(old)
    return text.replace(old, new, 1)

def between(text, start, end, new):
    assert text.count(start) == text.count(end) == 1
    a, b = text.index(start), text.index(end)
    assert a < b
    return text[:a] + new.rstrip() + '\n\n' + text[b:]

def skill_tweaks(text):
    text = once(text, '  type ExtensionAPI,\n', '  type ExtensionAPI,\n  formatSkillsForPrompt,\n')
    return once(text, '''  return replaceSkillCatalog(
    systemPrompt,
    skills.filter((skill) => !disabledNames.has(skill.name)),
    readTool,
  );''', '''  const visibleSkills = skills.filter((skill) => !disabledNames.has(skill.name));
  if (!visibleSkills.some((skill) => !skill.disableModelInvocation)) {
    // Remove only an exact SDK-generated section; keep unfamiliar host routing prose intact.
    const originalSection = formatSkillsForPrompt([...skills], readTool);
    if (originalSection && systemPrompt.includes(originalSection)) {
      return systemPrompt.replace(originalSection, "");
    }
  }
  return replaceSkillCatalog(systemPrompt, visibleSkills, readTool);''')
edit('.pi/agent/extensions/skill-tweaks/index.ts', skill_tweaks)

def native_runtime(text):
    text = once(text, 'import { execFileSync } from "node:child_process";', 'import { spawnSync } from "node:child_process";')
    text = once(text, 'const output = execFileSync(', 'const output = spawnSync(')
    return once(text, '''      const line = output.split("\\n").find((item) => item.startsWith("SKILL_RUNTIME_CHECK "));''', '''      expect(output.error).toBeUndefined();
      expect(output.status).toBe(0);
      // Print mode reserves stdout for model output and routes extension logs to stderr.
      expect(output.stdout).toBe("");
      const line = output.stderr.split("\\n").find((item) => item.startsWith("SKILL_RUNTIME_CHECK "));''')
edit('.pi/agent/extensions/skill-discovery/__tests__/native-runtime.test.ts', native_runtime)

def session_links(text):
    start = text.index('} from "@earendil-works/pi-tui";')
    pos = text.rfind('import {', 0, start) + len('import {')
    text = text[:pos] + '\n  getKeybindings,' + text[pos:]
    text = once(text, '''  TranscriptPane: new (options: {
    tui: TUI;''', '''  TranscriptPane: new (options: {
    tui: TUI;
    keys: ReturnType<typeof getKeybindings>;''')
    text = once(text, '''          new navigator.TranscriptPane({
            tui,''', '''          new navigator.TranscriptPane({
            tui,
            keys: getKeybindings(),''')
    return once(text, 'The installed 21.8.1 modules were inspected against these internal contracts.', 'The installed 23.0.0 modules were inspected against these internal contracts.')
edit('.pi/agent/extensions/prompt-ui/subagent-session-links.ts', session_links)

def devenv(text):
    return once(text, '''      cp .config/pi-hashline-edit-pro/config.json "$XDG_CONFIG_HOME/pi-hashline-edit-pro/"
''', '''      cp .config/pi-hashline-edit-pro/config.json "$XDG_CONFIG_HOME/pi-hashline-edit-pro/"
      mkdir -p "$XDG_CONFIG_HOME/fbb/data"
      cp .config/fbb/data/typos.abolish "$XDG_CONFIG_HOME/fbb/data/"
''')
edit('devenv.nix', devenv)

edit('.config/ags/scripts/tests/gjs/ai-pointer-view.case.tsx', lambda t: once(t,
    '\tawait settleMainLoop();\n\tassert(view.isSelectionPreviewVisible,',
    '\t// Let GTK allocate the widened entry before sampling its composition position.\n\tawait settleMainLoop(50);\n\tassert(view.isSelectionPreviewVisible,'))

edit('.config/ags/services/__tests__/waybar-control.case.ts', lambda t: between(t,
    'async function runChild(mode: string): Promise<void> {',
    'async function runControlInChild(', '''async function runChild(mode: string): Promise<void> {
\tlet failures = 0;
\t// GJS freezes console; its structured log writer observes each emitted record once.
\t// The GJS override accepts a callback despite GI exposing this argument as a pointer.
\tconst setLogWriter = GLib.log_set_writer_func as unknown as (writer: (
\t\tlevel: GLib.LogLevelFlags,
\t\tfields: Record<string, Uint8Array>,
\t) => GLib.LogWriterOutput) => void;
\tsetLogWriter((_level, fields) => {
\t\tconst message = fields.MESSAGE ? new TextDecoder().decode(fields.MESSAGE) : "";
\t\tif (message.startsWith("Waybar control request failed:")) {
\t\t\tfailures++;
\t\t\treturn GLib.LogWriterOutput.HANDLED;
\t\t}
\t\treturn GLib.LogWriterOutput.UNHANDLED;
\t});
\tshowWaybar();
\tif (mode === "success") {
\t\tawait waitFor(() => Gio.File.new_for_path(`${GLib.get_home_dir()}/request`).query_exists(null));
\t} else {
\t\tawait waitFor(() => failures > 0);
\t}
\tprint(`WAYBAR_CONTROL_RESULT ${failures}`);
}'''))

for path, text in changes.items():
    path.write_text(text)
print('Updated only these paths:')
print('\n'.join(str(path) for path in changes))
