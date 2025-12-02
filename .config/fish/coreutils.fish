# uutils-coreutils replacements
# Use a single check to avoid running 'alias' 28 times on every startup
# Check for one representative uutils binary instead of globbing all u* files
if test -x "$HOMEBREW_PREFIX/bin/ucp"
    # Create aliases in a single block to reduce overhead
    for cmd in cp date whoami pwd mv kill touch cat printf paste mkdir rm rmdir env cut join printenv mktemp uname sort tsort seq head tail uptime
        alias $cmd $HOMEBREW_PREFIX/bin/u$cmd
    end
end
