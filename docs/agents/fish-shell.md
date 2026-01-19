# Fish Shell Style

- Abbreviations: prefer `abbr` over `alias` (example: `abbr n nvim`)
- Functions: use for complex logic, `snake_case` naming
- Conditionals: use `switch/case` for platform detection
- Cross-platform compatibility: terminal emulator and shell scripts should work across macOS, Linux, and BSD unless otherwise specified
  - Use `switch (uname)` for platform-specific behavior
  - Test command availability with `command -v` before platform-specific tools
  - Prefer standard POSIX utilities when possible
