# User Commands and Utils

User commands:

- `DiffClip`: compare active buffer with clipboard
- `WipeAllSessions`: removes sessions in `.config/nvim/.sessions`
- `Z`: `wa | qa` shortcut

Utils:

- `utils.set_keymap(mode, lhs, rhs, opts_or_desc)` for keymaps
- `utils.set_usrcmd(cmd, callback, opts_or_desc)` for user commands
- `utils.wipe_all_sessions()` for session cleanup
