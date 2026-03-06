---
description: Copy previous assistant output to clipboard
---
Take the most recent assistant output in this chat and copy it to the system clipboard.
Use the first available tool in this order: `pbcopy`, `wl-copy`, `xclip -selection clipboard`, `xsel --clipboard --input`, `clip.exe`.
If there is no previous assistant output, report `copied: no` and `reason: no previous output`.

Then report only:
- copied: yes/no
- tool: <clipboard tool or none>
- bytes: <count>
