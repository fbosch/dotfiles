---
aliases: [yank]
description: Copy most recent command output to clipboard
---
Copy the most recent relevant command output to the system clipboard.
Use a cross-platform fallback order: `pbcopy` (macOS), `wl-copy` (Wayland), `xclip -selection clipboard`, `xsel --clipboard --input`, or `clip.exe` (Windows).
If needed, re-run the command and pipe/stdin its output into the first available clipboard tool.
