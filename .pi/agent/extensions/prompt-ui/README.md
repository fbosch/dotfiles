# Prompt UI

The custom footer can show a project-specific Nerd Font icon before the current
working directory. Configure it in `.pi/footer.json` for a trusted project:

```json
{
  "icon": "",
  "color": "blue"
}
```

The extension checks the trusted project first, then `~/.pi/agent/footer.json`.
Project configuration takes precedence. Colors accept named ANSI colors, hex
values such as `#4d6fb7`, or foreground ANSI SGR sequences. Run `/reload` after changing
the file.
