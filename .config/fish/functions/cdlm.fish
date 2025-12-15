function cdlm -d "Change to the latest modified directory in current working directory"
    # Get the current working directory (or use argument if provided)
    set -l target_dir (pwd)
    if test (count $argv) -gt 0
        set target_dir $argv[1]
    end

    # Check if target directory exists
    if not test -d $target_dir
        echo "Error: Directory '$target_dir' does not exist" >&2
        return 1
    end

    # Use fd to find directories, sort by modification time (newest first)
    set -l latest_dir (fd --type d --max-depth 1 --base-directory $target_dir --exec stat -f "%m %N" {} \; 2>/dev/null | sort -rn | head -n 1 | awk '{print $2}' | sed 's|^\./||')

    # Check if we found any directories
    if test -z "$latest_dir"
        echo "Error: No subdirectories found in '$target_dir'" >&2
        return 1
    end

    # Build the full path and normalize it
    set -l full_path (string replace -r '/\./' '/' "$target_dir/$latest_dir")

    # Change to the latest directory
    cd $full_path
    and echo "Changed to: $full_path"
end
