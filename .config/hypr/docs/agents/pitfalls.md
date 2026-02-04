# Common Pitfalls

1. Invalid syntax errors:
   - Always use `match:namespace <name>, <rule>` format (see `docs/agents/references/Window-Rules.md`)
   - Rules like `ignore_alpha` use underscores (not `ignorealpha`)
   - Check `hyprctl configerrors` after any changes

2. Layer stacking issues:
   - Use `order` rule to control z-index (see `docs/agents/references/Window-Rules.md`)
   - Lower/negative values render below, higher values on top
   - Default order is 0

3. Scripts not executing:
   - Ensure scripts in `scripts/` are executable: `chmod +x scripts/*.sh`
   - Scripts are referenced from config with full path: `~/.config/hypr/scripts/...`
   - For exec keyword behavior, see `docs/agents/references/Keywords.md`
