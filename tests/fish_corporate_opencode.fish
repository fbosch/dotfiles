#!/usr/bin/env fish

set -l repo_root (path resolve (path dirname (status filename))/..)
set -l test_home (mktemp -d)

function cleanup --on-event fish_exit
    command rm -rf "$test_home"
end

function vivid
    return 0
end

function tty
    printf '%s\n' /dev/tty
end

set -gx HOME "$test_home"
set -g OS_TYPE Linux
set -l opencode_variables \
    OPENCODE_CONFIG_DIR \
    OPENCODE_DISABLE_MODELS_FETCH \
    OPENCODE_EXPERIMENTAL_LSP_TOOL \
    OPENCODE_EXPERIMENTAL_LSP_TY \
    OPENCODE_EXPERIMENTAL_EXA \
    OPENCODE_TOON_PLUGIN_TOOLS
for variable in $opencode_variables
    set -e $variable
end

set -g CORPORATE 1
source "$repo_root/.config/fish/profile.fish"
source "$repo_root/.config/fish/functions/opencode.fish"
source "$repo_root/.config/fish/aliases.fish"

for variable in $opencode_variables
    set -q $variable; and exit 1
end
functions -q opencode; and exit 1
functions -q wsc; and exit 1
for abbreviation in oc ocps ocas liw
    abbr --query $abbreviation; and exit 1
end

set -e CORPORATE
source "$repo_root/.config/fish/profile.fish"
source "$repo_root/.config/fish/functions/opencode.fish"
source "$repo_root/.config/fish/aliases.fish"

for variable in $opencode_variables
    set -q $variable; or exit 1
end
functions -q opencode; or exit 1
functions -q wsc; or exit 1
for abbreviation in oc ocps ocas liw
    abbr --query $abbreviation; or exit 1
end
