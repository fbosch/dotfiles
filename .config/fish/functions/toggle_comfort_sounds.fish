function toggle_comfort_sounds --description 'Toggle macOS Comfort Sounds without privileged launchctl'
    set -l state (defaults read com.apple.ComfortSounds comfortSoundsEnabled 2>/dev/null)
    if test $status -ne 0
        set state 0
    end

    if test "$state" = "1"
        defaults write com.apple.ComfortSounds comfortSoundsEnabled -bool NO
    else
        defaults write com.apple.ComfortSounds comfortSoundsEnabled -bool YES
        defaults write com.apple.ComfortSounds lastEnablementTimestamp (date +%s)
    end

    set -l heard_pid (pgrep -u (id -u) -x heard 2>/dev/null)
    if test (count $heard_pid) -gt 0
        kill -HUP $heard_pid[1] 2>/dev/null
    end

    return 0
end
