# Local Wallpaper Extension - Implementation Notes

## Overview

This extension allows you to browse and apply wallpapers from your local collection directly in Vicinae, with seamless integration to Hyprland's hyprpaper.

## Architecture

### File Structure

```
local-wallpaper/
├── assets/
│   └── ICON_TODO.md           # Placeholder for extension icon
├── src/
│   ├── utils/
│   │   ├── filesystem.ts      # File scanning, sorting, formatting
│   │   └── hyprpaper.ts       # Hyprpaper config manipulation
│   ├── browse-wallpapers.tsx  # Main component (Grid + Detail views)
│   └── types.ts               # TypeScript type definitions
├── package.json               # Extension manifest & dependencies
├── tsconfig.json              # TypeScript configuration
├── README.md                  # User documentation
└── .gitignore                 # Git ignore patterns
```

## Key Components

### 1. **browse-wallpapers.tsx** (Main Component)
- Grid view displaying wallpapers from local directory
- Search functionality to filter by filename
- Dynamic sorting via dropdown (name, date, size)
- Detailed preview component with metadata
- Actions: Set as wallpaper, open in viewer, copy path, show in finder

### 2. **utils/filesystem.ts**
- `expandPath()`: Converts `~` to home directory
- `scanWallpapers()`: Reads directory and filters by extensions
- `sortWallpapers()`: Implements 5 sorting methods
- `formatFileSize()` / `formatDate()`: Human-readable formatting

### 3. **utils/hyprpaper.ts**
- `readHyprpaperConfig()`: Reads current config
- `writeHyprpaperConfig()`: Writes updated config
- `updateHyprpaperConfig()`: Updates preload and wallpaper lines
- `reloadHyprpaper()`: Kills and restarts hyprpaper process
- `setWallpaper()`: Complete workflow with toast notifications

## Hyprpaper Integration

### How Wallpaper Setting Works

1. **Read Config**: Parses `~/.config/hypr/hyprpaper.conf`
2. **Update Lines**: 
   - `preload = /new/wallpaper.png`
   - `wallpaper = [monitor],/new/wallpaper.png`
3. **Write Config**: Saves modified config
4. **Reload**: `pkill hyprpaper && hyprpaper &`

### Config Format Handling

The implementation preserves monitor specifications:
- If `wallpaper = Virtual-1,/path` exists, it updates to `Virtual-1,/new/path`
- If no monitor specified, it uses `,/path` (applies to all monitors)
- Maintains any other config lines (like `splash = false`)

## Features Implemented

✅ Grid view with image thumbnails  
✅ Search by filename  
✅ 5 sorting options  
✅ Full-size preview with metadata  
✅ One-click wallpaper application  
✅ Hyprpaper integration  
✅ Toast notifications  
✅ Copy paths / show in finder  
✅ Configurable preferences  
✅ Error handling  

## Next Steps

### 1. Add Extension Icon
```bash
cd /home/fbb/dotfiles/.config/vicinae/extensions/local-wallpaper/assets
# Add a 512x512px PNG icon named extension_icon.png
```

### 2. Install Dependencies
```bash
cd /home/fbb/dotfiles/.config/vicinae/extensions/local-wallpaper
npm install
```

### 3. Test the Extension
```bash
npm run dev
```

### 4. Optional Enhancements

Consider adding:
- **Image dimensions detection**: Use `image-size` package to show resolution
- **Thumbnail generation**: Cache smaller previews for faster loading
- **Recently used**: Track and display recently applied wallpapers
- **Favorites**: Mark favorite wallpapers for quick access
- **Per-monitor wallpapers**: Support different wallpapers for each monitor
- **Random wallpaper**: Action to apply a random wallpaper from collection

### 5. Test Scenarios

Test these use cases:
- [ ] Empty wallpapers directory
- [ ] Invalid directory path
- [ ] Non-existent hyprpaper.conf
- [ ] hyprpaper not installed/running
- [ ] Special characters in filenames
- [ ] Very large directories (100+ wallpapers)
- [ ] Missing file permissions

## Configuration Examples

### Preferences

Default values:
```json
{
  "wallpapersDirectory": "~/Pictures/wallpapers",
  "hyprpaperConfigPath": "~/.config/hypr/hyprpaper.conf",
  "fileExtensions": "png,jpg,jpeg,webp",
  "sortBy": "name"
}
```

### Hyprpaper Config

Expected format:
```conf
preload = ~/Pictures/wallpapers/grainy.png

wallpaper = Virtual-1,~/Pictures/wallpapers/grainy.png

splash = false
```

After applying new wallpaper:
```conf
preload = ~/Pictures/wallpapers/new-wallpaper.jpg

wallpaper = Virtual-1,~/Pictures/wallpapers/new-wallpaper.jpg

splash = false
```

## Known Limitations

1. **No recursive directory scanning**: Only scans the top-level wallpapers directory
2. **No image dimension detection**: Would require additional dependency (`image-size`)
3. **Basic hyprpaper config parsing**: May not handle all edge cases
4. **Single monitor focus**: Doesn't explicitly handle multi-monitor setups
5. **No thumbnail caching**: Full images loaded each time (may be slow for large collections)

## Dependencies

- `@vicinae/api` (^0.15.7): Vicinae extension API
- `typescript` (^5.9.3): TypeScript compiler
- Node.js built-ins: `fs/promises`, `path`, `child_process`, `util`

## Comparison with wallhaven-search

| Feature | wallhaven-search | local-wallpaper |
|---------|-----------------|-----------------|
| Grid view | ✅ | ✅ |
| Search | ✅ API search | ✅ Local filter |
| Preview | ✅ | ✅ |
| Sorting | ✅ (6 options) | ✅ (5 options) |
| Infinite scroll | ✅ | ❌ (All loaded) |
| Apply wallpaper | ✅ Download | ✅ Direct apply |
| Cache | ✅ React Query | ❌ (Scans on load) |
| API calls | ✅ Wallhaven | ❌ Local only |

## Troubleshooting

### Extension doesn't build
- Check Node.js version: `node --version` (needs v16+)
- Verify Vicinae CLI: `vici --version`
- Check dependencies: `npm install`

### Wallpapers don't load
- Verify directory exists: `ls ~/Pictures/wallpapers`
- Check file extensions match preferences
- Look for errors in Vicinae developer console

### Wallpaper doesn't apply
- Check hyprpaper: `which hyprpaper`
- Test manual config: `cat ~/.config/hypr/hyprpaper.conf`
- Try manual reload: `pkill hyprpaper && hyprpaper &`
- Check logs: `journalctl -b | grep hyprpaper`
