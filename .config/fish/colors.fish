function colors
    set color00 19/19/19 # Black
    set color01 e3/88/a3 # Red
    set color02 98/bd/99 # Green
    set color03 b7/7e/64 # Yellow
    set color04 97/bd/de # Blue
    set color05 b2/79/a7 # Magenta
    set color06 aa/aa/aa # Cyan
    set color07 bb/bb/bb # White
    set color08 99/99/99 # Bright Black
    set color09 $color01 # Bright Red
    set color10 $color02 # Bright Green
    set color11 $color03 # Bright Yellow
    set color12 $color04 # Bright Blue
    set color14 $color05 # Bright Magenta
    set color15 ff/ff/ff # Bright White
    set color16 e8/bb/d0 # Base 09
    set color17 cd/ab/53 # Base 0F
    set color18 3a/34/32 # Base 01
    set color19 4a/45/43 # Base 02
    set color20 80/7d/7c # Base 04
    set color21 d6/d5/d4 # Base 06
    set colorfg $color07 # Base 05 - White
    set colorbg $color00 # Base 00 - Black

    set colorfg $color07
    set colorbg $color00

    if test -n "$TMUX"
        # Tell tmux to pass the escape sequences through
        # (Source: http://permalink.gmane.org/gmane.comp.terminal-emulators.tmux.user/1324)
        function put_template
            printf '\033Ptmux;\033\033]4;%d;rgb:%s\033\033\\\033\\' $argv
        end

        function put_template_var
            printf '\033Ptmux;\033\033]%d;rgb:%s\033\033\\\033\\' $argv
        end

        function put_template_custom
            printf '\033Ptmux;\033\033]%s%s\033\033\\\033\\' $argv
        end

    else if string match 'screen*' $TERM # [ "${TERM%%[-.]*}" = "screen" ]
        # GNU screen (screen, screen-256color, screen-256color-bce)
        function put_template
            printf '\033P\033]4;%d;rgb:%s\007\033\\' $argv
        end

        function put_template_var
            printf '\033P\033]%d;rgb:%s\007\033\\' $argv
        end

        function put_template_custom
            printf '\033P\033]%s%s\007\033\\' $argv
        end

    else if string match 'linux*' $TERM # [ "${TERM%%-*}" = "linux" ]
        function put_template
            test $argv[1] -lt 16 && printf "\e]P%x%s" $argv[1] (echo $argv[2] | sed 's/\///g')
        end

        function put_template_var
            true
        end

        function put_template_custom
            true
        end

    else
        function put_template
            printf '\033]4;%d;rgb:%s\033\\' $argv
        end

        function put_template_var
            printf '\033]%d;rgb:%s\033\\' $argv
        end

        function put_template_custom
            printf '\033]%s%s\033\\' $argv
        end

    end

    put_template 0 $color00
    put_template 1 $color01
    put_template 2 $color02
    put_template 3 $color03
    put_template 4 $color04
    put_template 5 $color05
    put_template 6 $color06
    put_template 7 $color07
    put_template 8 $color08
    put_template 9 $color09
    put_template 10 $color10
    put_template 11 $color11
    put_template 12 $color12
    put_template 13 $color13
    put_template 14 $color14
    put_template 15 $color15

    # 256 color space
    put_template 16 $color16
    put_template 17 $color17
    put_template 18 $color18
    put_template 19 $color19
    put_template 20 $color20
    put_template 21 $color21

    # foreground / background / cursor color
    if test -n "$ITERM_SESSION_ID"
        # iTerm2 proprietary escape codes
        put_template_custom Pg a5a2a2 # foreground
        put_template_custom Ph 090300 # background
        put_template_custom Pi a5a2a2 # bold color
        put_template_custom Pj 4a4543 # selection color
        put_template_custom Pk a5a2a2 # selected text color
        put_template_custom Pl a5a2a2 # cursor
        put_template_custom Pm 090300 # cursor text
    else
        put_template_var 10 $colorfg
        if [ "$BASE16_SHELL_SET_BACKGROUND" != false ]
            put_template_var 11 $colorbg
            if string match 'rxvt*' $TERM # [ "${TERM%%-*}" = "rxvt" ]
                put_template_var 708 $colorbg # internal border (rxvt)
            end
        end
        put_template_custom 12 ";7" # cursor (reverse video)
    end

    # set syntax highlighting colors
    set -U fish_color_autosuggestion 4a4543
    set -U fish_color_cancel -r
    set -U fish_color_command green #white
    set -U fish_color_comment 4a4543
    set -U fish_color_cwd green
    set -U fish_color_cwd_root red
    set -U fish_color_end brblack #blue
    set -U fish_color_error red
    set -U fish_color_escape yellow #green
    set -U fish_color_history_current --bold
    set -U fish_color_host normal
    set -U fish_color_match --background=brblue
    set -U fish_color_normal normal
    set -U fish_color_operator blue #green
    set -U fish_color_param 807d7c
    set -U fish_color_quote yellow #brblack
    set -U fish_color_redirection cyan
    set -U fish_color_search_match bryellow --background=4a4543
    set -U fish_color_selection white --bold --background=4a4543
    set -U fish_color_status red
    set -U fish_color_user brgreen
    set -U fish_color_valid_path --underline
    set -U fish_pager_color_completion normal
    set -U fish_pager_color_description yellow --dim
    set -U fish_pager_color_prefix white --bold #--underline
    set -U fish_pager_color_progress brwhite --background=cyan
end
