function herdr_link_plugins --description "Link local Herdr plugins from this dotfiles checkout"
    if not type -q herdr
        printf 'herdr is not installed.\n' >&2
        return 127
    end

    set -l config_home $XDG_CONFIG_HOME
    if test -z "$config_home"
        set config_home "$HOME/.config"
    end

    for plugin_id in neovim-sessions worktrunk-lifecycle
        # Resolve the manifest so Herdr and Stow agree on the plugin root.
        set -l manifest (path resolve "$config_home/herdr/plugins/$plugin_id/herdr-plugin.toml")
        set -l plugin_root (path dirname "$manifest")
        if not test -f "$manifest"
            printf 'Missing Herdr plugin manifest: %s\n' "$manifest" >&2
            return 1
        end

        set -l linked_root (herdr plugin list --json | jq -r --arg id "$plugin_id" '.result.plugins[]? | select(.plugin_id == $id and .source.kind == "local") | .plugin_root')
        if test "$linked_root" = "$plugin_root"
            continue
        end

        if test -n "$linked_root"
            printf 'Herdr plugin %s is linked from %s, not %s.\n' "$plugin_id" "$linked_root" "$plugin_root" >&2
            return 1
        end

        herdr plugin link "$plugin_root"
        or return $status
    end
end
