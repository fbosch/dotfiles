# Native transient placement

`rules/init.lua` registers `rules.transient_placement`. Production runs
`transient-placement` 0.1.0; the old late-placement Lua handler is not registered.
Future plugin changes still require isolated validation before production loading.

## Configuration ownership

`rules/transient_placement.lua` contains the six existing parent-child
relationships and the Obsidian floating-size rule. App selectors, floating
rules, sizes, and monitor routing remain in Lua. The plugin only selects a
parent and supplies the initial centered position before floating layout.

The adapter in `plugins/transient_placement.lua` loads the path from
`HYPR_TRANSIENT_PLACEMENT_PLUGIN`. It configures the plugin only after
`hl.get_loaded_plugins()` confirms registration. Initial deferred loading
waits for the scheduled config parse. Loading or configuration errors report
that the policy was not applied; there is no late-placement fallback.

```lua
hl.plugin.transient_placement.configure({
  {
    parent_class = "nemo",
    child_class = "org.gnome.Loupe",
    infer_focused_parent = true,
    no_anim = true,
  },
})
```

Classes are exact strings. The child matches its initial class and title.
`child_title_prefixes` restricts that title to the supplied prefixes; an omitted
or empty list allows any title. Focus inference and animation suppression are
opt-in per relationship. `configure({})` disables placement. Each successful
configuration replaces the previous policy rather than adding listeners.

A declared parent is authoritative. If it does not match the configured
relationship, the plugin must not choose a focused window instead. When no
parent is declared, an opted-in relationship can use the focused mapped window
captured before the child receives focus. This remains an inference, not proof
that the focused window launched the child.

The tested browser popups, Obsidian Settings, and Nemo-launched viewers did not
declare parents. Obsidian's Community plugins catalogue opens inside Settings,
not in a separate matching window. Zenity parent tracing remains unverified.

## Activation

Register only `rules.transient_placement`; never register both placement
handlers. Install the matching plugin package and session environment before
loading it. New Lua files must also be Stow-linked into `~/.config/hypr/` before
reloading; a NixOS rebuild alone does not deploy those links.

Editing the active Stow-linked module can trigger Hyprland's config watcher,
even without an explicit reload command.

Focused unit checks run with:

```sh
busted --lua=luajit .config/hypr/tests/transient_placement_spec.lua
```

Run `devenv test` for repository validation. Runtime acceptance requires a private
nested compositor with a plugin built against that compositor. Production
activation is a separate authorized step.


The opt-in probe is `tests/runtime/transient_placement_sandbox.py`. Set
`TEST_HYPRLAND_DIR` to the matching compositor's `bin` directory, `TEST_PLUGIN`
to `libtransient-placement.so`, and `TEST_GTK_LIBRARY` to an installed GTK4
`libgtk-4.so.1`. It uses private HOME/XDG directories, checks the instance PID
and signature before mutations, and stops the compositor and fixture on exit.

Single-output validation passed against Hyprland `5a78b5e`: 11 first-placement
and lifecycle cases, six rejected malformed configurations, and registration
through the Lua adapter. Matching native build and policy tests passed,
as did focused Lua tests and Lua quality checks. The user confirmed that
real-app placement appears to work after activation. Dedicated multi-monitor
and XWayland acceptance remain unverified. The full `devenv test` run failed
in five tests outside this change.
