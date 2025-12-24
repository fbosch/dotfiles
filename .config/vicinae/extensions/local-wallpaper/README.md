# Local Wallpaper Extension

Browse and apply wallpapers from your local collection directly in Vicinae. Seamlessly integrates with Hyprland's hyprpaper to set desktop backgrounds with multi-monitor support.

## Features

- 🖼️ Browse wallpapers from your local directory
- 🎨 Grid view with image previews (edge-to-edge display)
- 🔍 Search wallpapers by name
- 📊 Multiple sorting options (name, date modified, size)
- 🖥️ **Multi-monitor support** - set wallpapers per monitor or all at once
- 🎯 **Fill mode selection** - choose how wallpapers fit the screen (cover, contain, tile, fill)
- 🎯 One-click wallpaper application via hyprpaper
- 👁️ Full-size preview with detailed metadata
- 📋 Copy file paths to clipboard
- 🔄 Refresh wallpaper list on demand
- 📁 Show in file manager

## Requirements

- **Hyprland** with **hyprpaper** installed
  - **Per-monitor fit modes** require hyprpaper v0.8+ (unreleased as of Dec 2024)
  - hyprpaper v0.7.x supports setting wallpapers per monitor, but not custom fit modes per monitor
- Node.js filesystem access (works in desktop Vicinae)
- Wallpapers directory with image files

## Preferences

Configure the extension in Vicinae preferences:

- **Wallpapers Directory**: Directory containing your wallpapers (default: `~/Pictures/wallpapers`)
- **Hyprpaper Config Path**: Path to your hyprpaper.conf file (default: `~/.config/hypr/hyprpaper.conf`)
- **File Extensions**: Comma-separated list of image extensions to include (default: `png,jpg,jpeg,webp`)
- **Sort By**: Default sorting method (Name, Date Modified, Size)

## Usage

1. Install dependencies: `npm install`
2. Build or run in dev mode: `npm run dev`
3. Browse your wallpaper collection in the grid view
4. Use the search bar to filter by name
5. Change sorting via the dropdown menu
6. Press **Enter** on any wallpaper to see full preview
7. Press **Cmd+S** to set as wallpaper

## Actions

### On Wallpapers
- **Enter** or **Cmd+S**: Set as wallpaper with fill mode selection
  - **Single monitor**: Opens submenu to choose fill mode
  - **Multiple monitors**: Opens submenu to choose monitor, then fill mode for each
  - Fill modes available:
    - **Cover (default)**: Fill screen, crop edges if needed (maintains aspect ratio)
    - **Contain**: Fit entire image within screen (may show bars)
    - **Tile**: Repeat image to fill screen
    - **Fill**: Stretch to fill screen (may distort image)
- **Cmd+O**: Open in default image viewer
- **Cmd+C**: Copy file path to clipboard
- **Cmd+R**: Refresh wallpaper list
- **Ctrl+X**: Delete wallpaper (with confirmation)

## Multi-Monitor Support

When multiple monitors are detected, the extension automatically provides a submenu when setting wallpapers:

1. **All Monitors**: Apply the wallpaper to every connected display with chosen fill mode
2. **Individual Monitors**: Set different wallpapers and fill modes for each monitor
   - Displays monitor name and resolution (e.g., "DP-1 (2560x1440)")
   - Each monitor can have its own unique wallpaper and fill mode
   - Settings persist in hyprpaper.conf

### Fill Modes

The extension supports hyprpaper's fill modes:

- **Cover** (default): Fills the screen while maintaining aspect ratio, cropping edges if necessary
- **Contain**: Fits the entire image within the screen, may show bars on sides
- **Tile**: Repeats the image to fill the screen
- **Fill**: Stretches the image to fill the screen (may distort the image)

**Version Note**: Per-monitor fit modes are only available with hyprpaper v0.8+. With hyprpaper v0.7.x:
- Fill modes work when applying to **all monitors**
- Individual monitor wallpapers use the default fit mode (cover)

### How It Works

The extension detects monitors using `hyprctl monitors -j` and updates the hyprpaper configuration.

**Hyprpaper v0.8+ (new block syntax)**:
```conf
# Preloaded wallpapers
preload = /path/to/wallpaper1.png
preload = /path/to/wallpaper2.png

# Monitor wallpaper assignments (new block syntax)
wallpaper {
    monitor = DP-1
    path = /path/to/wallpaper1.png
    fit_mode = cover
}

wallpaper {
    monitor = HDMI-A-1
    path = /path/to/wallpaper2.png
    fit_mode = tile
}

# Or apply to all monitors (no monitor specified)
wallpaper {
    path = /path/to/wallpaper.png
    fit_mode = contain
}

splash = false
```

**Hyprpaper v0.7.x (legacy syntax)**:
```conf
# Preloaded wallpapers
preload = /path/to/wallpaper1.png
preload = /path/to/wallpaper2.png

# Monitor wallpaper assignments (legacy syntax, no per-monitor fit modes)
wallpaper = DP-1,/path/to/wallpaper1.png
wallpaper = HDMI-A-1,/path/to/wallpaper2.png

splash = false
```

The extension automatically uses the appropriate format based on your hyprpaper version.

## How It Works

### Wallpaper Application

When you set a wallpaper, the extension:

1. **Detects hyprpaper version**: Automatically uses compatible syntax (v0.8+ block format or v0.7.x legacy format)
2. **Updates hyprpaper.conf**: Writes wallpaper configuration with monitor and fit mode settings
3. **Preserves multi-monitor setup**: Keeps existing per-monitor configurations when updating
4. **Reloads hyprpaper**: Kills the existing hyprpaper process and starts a new one
5. **Shows confirmation**: Displays a toast notification with monitor and fill mode details

**Note**: Per-monitor fit mode selection is only applied when using hyprpaper v0.8+. With v0.7.x, individual monitor wallpapers use the default fit mode.

### Configuration Format

The extension automatically detects your hyprpaper version and uses the appropriate format.

**Hyprpaper v0.8+ (new block syntax with fit modes)**:
```conf
# Preloaded wallpapers
preload = /path/to/wallpaper.png

# Monitor wallpaper assignments
wallpaper {
    monitor = DP-1
    path = /path/to/wallpaper.png
    fit_mode = cover
}

splash = false
```

**Hyprpaper v0.7.x (legacy syntax)**:
```conf
# Preloaded wallpapers
preload = /path/to/wallpaper.png

# Monitor wallpaper assignments (no per-monitor fit modes)
wallpaper = DP-1,/path/to/wallpaper.png

splash = false
```

### File Scanning

- Recursively scans the configured wallpapers directory
- Filters files by configured extensions
- Reads file metadata (size, modified date)
- Sorts according to preference
- Supports search filtering by filename

## Sorting Options

- **Name (A-Z)**: Alphabetical by filename
- **Date Modified (Newest)**: Most recently modified first
- **Date Modified (Oldest)**: Oldest files first
- **Size (Largest)**: Largest files first
- **Size (Smallest)**: Smallest files first

## Supported Image Formats

Default: PNG, JPG, JPEG, WEBP

Configure additional formats in preferences by adding extensions to the comma-separated list.

## Troubleshooting

### Wallpapers not loading
- Check that the wallpapers directory exists and is accessible
- Verify file extensions match those configured in preferences
- Use **Cmd+R** to manually refresh the list

### Wallpaper not applying
- Ensure hyprpaper is installed: `which hyprpaper`
- Check hyprpaper config path in preferences
- Verify the config file is writable
- Check system logs for hyprpaper errors

### Multi-monitor issues
- Verify monitors are detected: `hyprctl monitors -j`
- Check that monitor names match those in Hyprland
- Reload extension after connecting/disconnecting monitors

### Fill mode not working
- The extension currently uses hyprpaper v0.7.x compatible syntax
- Per-monitor fit modes require hyprpaper v0.8+ (unreleased)
- With v0.7.x:
  - Fill modes work when setting wallpaper for **all monitors**
  - Individual monitor wallpapers use the default fit mode (cover)
- Check your hyprpaper version: `hyprpaper --version`
- When v0.8+ is released, the extension will automatically support per-monitor fit modes

### Images not displaying in grid
- Ensure Vicinae has filesystem access permissions
- Verify image files are valid and not corrupted
- Check that file paths don't contain special characters that need escaping

## Future Enhancements

- **Version Detection**: Automatically detect hyprpaper version and switch to v0.8+ block syntax when available
- **Wallpaper Collections**: Save and load wallpaper sets for different moods/themes
- **Dynamic Wallpapers**: Support for time-based wallpaper rotation

## Build

To build for production:

```bash
npm run build
```

## Development

```bash
npm run dev
```
