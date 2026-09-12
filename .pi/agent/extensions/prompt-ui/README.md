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
