#!/usr/bin/env bash
# Show confirmation dialog before exiting Hyprland using rofi

# Rofi command with styling
rofi_cmd() {
    rofi -dmenu \
        -i \
        -p "Exit Hyprland?" \
        -mesg "This will end your session" \
        -selected-row 1 \
        -no-show-icons \
        -no-lazy-grab \
        -matching fuzzy \
        -theme-str 'window {
            width: 500px;
            background-color: rgba(32, 32, 32, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 18px;
            padding: 24px;
        }
        mainbox {
            background-color: transparent;
            padding: 12px;
        }
        inputbar {
            background-color: transparent;
            padding: 8px 0px 16px 0px;
            children: [prompt, textbox-prompt-sep, entry];
        }
        prompt {
            font: "SF Pro Rounded 20";
            text-color: #ffffff;
            background-color: transparent;
            padding: 0px 0px 8px 0px;
        }
        textbox-prompt-sep {
            expand: false;
            str: "";
        }
        message {
            background-color: transparent;
            padding: 0px 0px 12px 0px;
        }
        textbox {
            font: "SF Pro Rounded 12";
            text-color: #cccccc;
            background-color: transparent;
        }
        listview {
            background-color: transparent;
            padding: 8px 0px 0px 0px;
            spacing: 8px;
            lines: 2;
            fixed-height: true;
        }
        element {
            background-color: rgba(45, 45, 45, 0.6);
            text-color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px 16px;
            font: "SF Pro Rounded 14";
        }
        element selected.normal {
            background-color: rgba(55, 55, 55, 0.7);
            border-color: rgba(255, 255, 255, 0.15);
        }
        element-text {
            background-color: transparent;
            text-color: inherit;
        }'
}

# Options (Exit first, but Cancel is pre-selected via -selected-row 1)
options="Exit\nCancel"

# Show dialog
choice=$(echo -e "$options" | rofi_cmd)

# Handle choice
case "$choice" in
    "Exit")
        uwsm stop
        ;;
    "Cancel"|"")
        # Do nothing
        ;;
esac
