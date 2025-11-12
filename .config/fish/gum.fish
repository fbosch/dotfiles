# === Gum Styling Configuration (Zenwritten Dark Theme) ===
# Zenwritten Dark Color Palette:
# - Background: #191919
# - Foreground: #bbbbbb
# - Accent Blue: #97bdde (110)
# - Green: #97d59b (2)
# - Red: #de8787 (1)
# - Purple: #d7aed7 (140)
# - Gray: #636363 (244)
# - Border: #303030 (240)

# Choose: Interactive option selection
set -gx GUM_CHOOSE_HEADER_FOREGROUND 110              # Accent blue (header)
set -gx GUM_CHOOSE_ITEM_FOREGROUND 244                # Gray (default items)
set -gx GUM_CHOOSE_SELECTED_FOREGROUND 2              # Green (selected)
set -gx GUM_CHOOSE_UNSELECTED_FOREGROUND 1            # Red (unselected)
set -gx GUM_CHOOSE_CURSOR_FOREGROUND 140              # Purple (cursor)
set -gx GUM_CHOOSE_SELECTED_PREFIX "󰄲 "              # Nerd Font: checkbox checked
set -gx GUM_CHOOSE_UNSELECTED_PREFIX "󰄱 "            # Nerd Font: checkbox unchecked
set -gx GUM_CHOOSE_CURSOR_PREFIX "󰡖 "                # Nerd Font: arrow right
set -gx GUM_CHOOSE_HEADER_BACKGROUND ""
set -gx GUM_CHOOSE_ITEM_BACKGROUND ""
set -gx GUM_CHOOSE_SELECTED_BACKGROUND ""
set -gx GUM_CHOOSE_UNSELECTED_BACKGROUND ""
set -gx GUM_CHOOSE_STRIP_ANSI false

# Input: Single-line text entry
set -gx GUM_INPUT_CURSOR_FOREGROUND "#97bdde"         # Accent blue (cursor)
set -gx GUM_INPUT_CURSOR_BACKGROUND "#191919"         # Main background
set -gx GUM_INPUT_PROMPT_FOREGROUND "#97bdde"         # Accent blue (prompt)
set -gx GUM_INPUT_PROMPT_BACKGROUND "#191919"         # Main background
set -gx GUM_INPUT_TEXT_FOREGROUND "#bbbbbb"           # Light gray (text)
set -gx GUM_INPUT_PLACEHOLDER_FOREGROUND "#636363"    # Muted gray (placeholder)
set -gx GUM_INPUT_BORDER_FOREGROUND "#303030"         # Dark gray (border)
set -gx GUM_INPUT_BACKGROUND "#191919"                # Main background

# Write: Multi-line text entry
set -gx GUM_WRITE_CURSOR_FOREGROUND "#97bdde"         # Accent blue (cursor)
set -gx GUM_WRITE_BASE_FOREGROUND "#bbbbbb"           # Light gray (text)
set -gx GUM_WRITE_PLACEHOLDER_FOREGROUND "#636363"    # Muted gray (placeholder)
set -gx GUM_WRITE_BORDER_FOREGROUND "#303030"         # Dark gray (border)
set -gx GUM_WRITE_BACKGROUND "#191919"                # Main background
set -gx GUM_WRITE_PROMPT_FOREGROUND "#97bdde"         # Accent blue (prompt)
set -gx GUM_WRITE_END_OF_BUFFER_FOREGROUND "#636363"  # Muted gray (end marker)

# Filter: Fuzzy search and filter
set -gx GUM_FILTER_INDICATOR "󰜴 "                     # Nerd Font: search icon
set -gx GUM_FILTER_INDICATOR_FOREGROUND 140           # Purple (indicator)
set -gx GUM_FILTER_MATCH_FOREGROUND 2                 # Green (matched text)
set -gx GUM_FILTER_HEADER_FOREGROUND 110              # Accent blue (header)
set -gx GUM_FILTER_TEXT_FOREGROUND "#bbbbbb"          # Light gray (text)
set -gx GUM_FILTER_CURSOR_TEXT_FOREGROUND 110         # Accent blue (selected line)
set -gx GUM_FILTER_PLACEHOLDER_FOREGROUND "#636363"   # Muted gray (placeholder)
set -gx GUM_FILTER_PROMPT_FOREGROUND "#97bdde"        # Accent blue (prompt)
set -gx GUM_FILTER_BORDER_FOREGROUND "#303030"        # Dark gray (border)

# Confirm: Yes/No confirmation
set -gx GUM_CONFIRM_SELECTED_FOREGROUND 2             # Green (affirmative)
set -gx GUM_CONFIRM_UNSELECTED_FOREGROUND 244         # Gray (unselected)
set -gx GUM_CONFIRM_PROMPT_FOREGROUND "#97bdde"       # Accent blue (prompt)
set -gx GUM_CONFIRM_SELECTED_BACKGROUND ""
set -gx GUM_CONFIRM_UNSELECTED_BACKGROUND ""

# Spin: Loading spinner
set -gx GUM_SPIN_SPINNER "dot"                        # Spinner style
set -gx GUM_SPIN_SPINNER_FOREGROUND 140               # Purple (spinner)
set -gx GUM_SPIN_TITLE_FOREGROUND "#97bdde"           # Accent blue (title)

# Style: Text styling defaults
set -gx GUM_STYLE_FOREGROUND "#bbbbbb"                # Light gray (default text)
set -gx GUM_STYLE_BACKGROUND "#191919"                # Main background
set -gx GUM_STYLE_BORDER_FOREGROUND "#303030"         # Dark gray (border)

# Format: Text formatting
set -gx GUM_FORMAT_THEME "dark"                       # Use dark theme for markdown/code

# Pager: Content scrolling
set -gx GUM_PAGER_BORDER_FOREGROUND "#303030"         # Dark gray (border)
set -gx GUM_PAGER_MATCH_FOREGROUND 2                  # Green (search matches)
set -gx GUM_PAGER_MATCH_HIGHLIGHT_FOREGROUND 110      # Accent blue (highlighted match)
set -gx GUM_PAGER_LINE_NUMBER_FOREGROUND "#636363"    # Muted gray (line numbers)

# File: File browser
set -gx GUM_FILE_CURSOR " "                          # Nerd Font: folder icon
set -gx GUM_FILE_CURSOR_FOREGROUND 140                # Purple (cursor)
set -gx GUM_FILE_HEADER_FOREGROUND 110                # Accent blue (header)
set -gx GUM_FILE_BORDER_FOREGROUND "#303030"          # Dark gray (border)

# Log: Structured logging
set -gx GUM_LOG_LEVEL_FOREGROUND 110                  # Accent blue (log level)
set -gx GUM_LOG_TIME_FOREGROUND "#636363"             # Muted gray (timestamp)
set -gx GUM_LOG_PREFIX_FOREGROUND 140                 # Purple (prefix)

# Table: Tabular data display
set -gx GUM_TABLE_BORDER_FOREGROUND "#303030"         # Dark gray (border)
set -gx GUM_TABLE_HEADER_FOREGROUND 110               # Accent blue (header)
set -gx GUM_TABLE_CELL_FOREGROUND "#bbbbbb"           # Light gray (cells)
set -gx GUM_TABLE_SELECTED_FOREGROUND 2               # Green (selected row)
set -gx GUM_TABLE_CURSOR_FOREGROUND 140               # Purple (cursor)
