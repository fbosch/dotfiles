function ld
    ls -l --sort=date --ignore-glob="node_modules" -D --time-style=relative $argv
end
