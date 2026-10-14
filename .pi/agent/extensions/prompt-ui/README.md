# Prompt UI

The custom footer can show a project-specific Nerd Font icon before the current
working directory. Configure it in `.pi/settings.json` for a trusted project:

```json
{
  "footer": {
    "icon": "",
    "color": "purple"
  }
}
```

The extension checks the trusted project first, then
`~/.pi/agent/settings.json`. Project configuration takes precedence. Colors
accept named ANSI colors, hex values such as `#4d6fb7`, or foreground ANSI SGR
sequences. Run `/reload` after changing the file.

The lock beside MCP is green `` when `NONO_CAP_FILE` is non-empty, and yellow
`` otherwise. It appears even when there is no MCP status. This is display-only
nono metadata, not independent verification of kernel confinement. Run `/reload`
after updating the extension.
