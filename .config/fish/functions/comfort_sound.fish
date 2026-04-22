function comfort_sound --description 'Set macOS Comfort Sound (gum picker or direct name)'
    set -l options h/help
    argparse -n comfort_sound $options -- $argv
    or return

    if set -q _flag_help
        echo "Usage: comfort_sound [SOUND_NAME]"
        echo "Set macOS Comfort Sound by name or pick one with gum"
        return 0
    end

    if test (uname) != Darwin
        echo "comfort_sound: macOS only" >&2
        return 1
    end

    if not command -q bun
        echo "comfort_sound: bun not found" >&2
        return 1
    end

    set -l helper_dir (path dirname (status filename))
    set -l helper "$helper_dir/comfort_sound_helper.ts"
    if not test -f "$helper"
        echo "comfort_sound: helper not found: $helper" >&2
        return 1
    end

    set -l sound_name

    if test (count $argv) -gt 0
        set sound_name "$argv[1]"
    else
        if not command -q gum
            echo "comfort_sound: gum not found (or pass SOUND_NAME directly)" >&2
            return 1
        end

        set -l available_sounds (bun "$helper" list)
        if test $status -ne 0
            return 1
        end

        if test (count $available_sounds) -eq 0
            echo "comfort_sound: no installed comfort sounds found" >&2
            return 1
        end

        set -l display_options
        set -l option_to_sound

        for sound in $available_sounds
            set -l icon "🎵"
            switch $sound
                case Rain
                    set icon "🌧"
                case Ocean
                    set icon "🌊"
                case Stream
                    set icon "🏞"
                case Fire
                    set icon "🔥"
                case Night
                    set icon "🌙"
                case WhiteNoise
                    set icon "⚪"
                case BrownNoise
                    set icon "🟤"
                case PinkNoise
                    set icon "🌸"
            end

            set -l label "$icon $sound"
            set display_options $display_options "$label"
            set option_to_sound $option_to_sound "$sound"
        end

        set -l picked_label (printf '%s\n' $display_options | gum choose --header "Select comfort sound")
        if test -z "$picked_label"
            return 0
        end

        for i in (seq (count $display_options))
            if test "$display_options[$i]" = "$picked_label"
                set sound_name "$option_to_sound[$i]"
                break
            end
        end
    end

    set -l selected (bun "$helper" set "$sound_name")
    if test $status -ne 0
        return 1
    end

    echo "Comfort sound set to $selected"
end
