# Quick Start Guide

## Setup (First Time)

```bash
# 1. Navigate to extension directory
cd ~/.config/vicinae/extensions/local-wallpaper

# 2. Add an extension icon (required)
cp ../wallhaven-search/assets/extension_icon.png assets/extension_icon.png

# 3. Install dependencies
npm install

# 4. Test in development mode
npm run dev
```

## Usage

1. Open Vicinae
2. Search for "Browse Local Wallpapers" command
3. Your wallpapers from `~/Pictures/wallpapers` will appear in a grid
4. Press **Enter** on any wallpaper to preview
5. Press **Cmd+S** to set as desktop wallpaper

## Keyboard Shortcuts

### In Grid View
- **Type**: Search/filter by filename
- **Enter**: Show full preview
- **Cmd+S**: Set as wallpaper
- **Cmd+C**: Copy file path
- **Cmd+R**: Refresh wallpaper list
- **Cmd+Shift+F**: Show in file manager

### In Preview
- **Cmd+S**: Set as wallpaper
- **Cmd+O**: Open in image viewer
- **Esc**: Return to grid

## Configuration

Open Vicinae preferences and configure:
- **Wallpapers Directory**: Where your wallpapers are stored
- **Hyprpaper Config Path**: Location of hyprpaper.conf
- **File Extensions**: Image types to include (png,jpg,jpeg,webp)
- **Sort By**: Default sorting method

## Troubleshooting

**Problem**: Extension doesn't appear in Vicinae  
**Solution**: Run `npm run build` and restart Vicinae

**Problem**: Wallpapers don't load  
**Solution**: Check that `~/Pictures/wallpapers` exists and contains images

**Problem**: Can't set wallpaper  
**Solution**: Verify hyprpaper is installed: `which hyprpaper`

**Problem**: "No such file or directory" error  
**Solution**: Check paths in preferences are correct and use `~` for home directory

## What It Does

When you set a wallpaper:
1. ✍️ Updates your `~/.config/hypr/hyprpaper.conf`
2. 🔄 Reloads hyprpaper (`pkill hyprpaper && hyprpaper &`)
3. ✅ Shows success notification
4. 🖼️ Your desktop wallpaper changes immediately

## Examples

### Custom Wallpaper Directory
Set in preferences: `~/Dropbox/Backgrounds`

### Different Config Location
Set in preferences: `~/.config/hyprland/hyprpaper.conf`

### More File Types
Set in preferences: `png,jpg,jpeg,webp,gif,bmp`

### Sort by Date (Newest First)
Use dropdown in extension: "Date Modified (Newest)"
