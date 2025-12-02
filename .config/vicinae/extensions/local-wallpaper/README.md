# Local Wallpaper Extension

Browse and apply wallpapers from your local collection directly in Vicinae. Seamlessly integrates with Hyprland's hyprpaper to set desktop backgrounds.

## Features

- 🖼️ Browse wallpapers from your local directory
- 🎨 Grid view with image previews (edge-to-edge display)
- 🔍 Search wallpapers by name
- 📊 Multiple sorting options (name, date modified, size)
- 🖥️ One-click wallpaper application via hyprpaper
- 👁️ Full-size preview with detailed metadata
- 📋 Copy file paths to clipboard
- 🔄 Refresh wallpaper list on demand
- 📁 Show in file manager

## Requirements

- **Hyprland** with **hyprpaper** installed
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
- **Enter** or **Cmd+S**: Set as wallpaper (updates hyprpaper.conf and reloads)
- **Cmd+O**: Open in default image viewer
- **Cmd+C**: Copy file path to clipboard
- **Cmd+R**: Refresh wallpaper list
- **Ctrl+X**: Delete wallpaper (with confirmation)



## How It Works

### Wallpaper Application

When you set a wallpaper, the extension:

1. **Updates hyprpaper.conf**: Modifies the `preload` and `wallpaper` lines with the new wallpaper path
2. **Reloads hyprpaper**: Kills the existing hyprpaper process and starts a new one
3. **Shows confirmation**: Displays a toast notification when successful

### Configuration Format

The extension expects `hyprpaper.conf` in this format:

```conf
preload = /path/to/wallpaper.png

wallpaper = ,/path/to/wallpaper.png

splash = false
```

The extension preserves monitor specifications if present (e.g., `wallpaper = Virtual-1,/path/to/wallpaper.png`).

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

### Images not displaying in grid
- Ensure Vicinae has filesystem access permissions
- Verify image files are valid and not corrupted
- Check that file paths don't contain special characters that need escaping

## Build

To build for production:

```bash
npm run build
```

## Development

```bash
npm run dev
```
