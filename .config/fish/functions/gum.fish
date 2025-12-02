# Lazy-load gum configuration on first use
function gum --wraps gum --description "Load gum config and run gum"
    # Source gum environment variables on first use
    if test -f ~/.config/fish/gum.fish
        source ~/.config/fish/gum.fish
    end
    
    # Remove this wrapper function so next calls go directly to gum
    functions -e gum
    
    # Run the actual gum command
    command gum $argv
end
