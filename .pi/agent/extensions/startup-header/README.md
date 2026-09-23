# Startup header

The header can replace its `pi` mark with project-specific ASCII art. It checks these files in order:

1. `<project>/.pi/startup-header.txt`, when Pi trusts the project
2. `~/.pi/agent/startup-header.txt`
3. The built-in `pi` mark

The file uses Fastfetch text-logo markers. `$1` through `$9` change the color for the following text. Write `$$` for a literal dollar sign.

```text
$1  ____  $2 _
$1 |  _ \\ $2| |
$1 | |_) |$2|_|
```

The global sample is [`../../startup-header.txt`](../../startup-header.txt). Copy it to `<project>/.pi/startup-header.txt` to customize one trusted project.

Define Fastfetch-style marker colors in `.pi/startup-header.json`. The extension checks the trusted project first, then `~/.pi/agent/startup-header.json`.

```json
{
  "color": {
    "1": "#4d6fb7",
    "2": "#77b6e1"
  }
}
```

Colors accept `#RGB`, `#RRGGBB`, ANSI SGR sequences such as `38;2;77;111;183`, and the names `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, and `white`. Markers without a configured color use the Pi theme roles below.

The markers follow the active Pi theme:

| Marker | Theme role |
| ------ | ---------- |
| `$1`   | accent     |
| `$2`   | success    |
| `$3`   | warning    |
| `$4`   | error      |
| `$5`   | text       |
| `$6`   | muted      |
| `$7`   | dim        |
| `$8`   | border     |
| `$9`   | tool title |

Lines wider than the terminal are clipped without an ellipsis. Run `/reload` after changing the file.
