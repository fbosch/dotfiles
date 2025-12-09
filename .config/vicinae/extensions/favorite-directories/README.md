# Favorite Directories Extension

Quickly access your favorite directories directly from Vicinae's global search.

## Features

- **Direct Access**: Type "Downloads", "Documents", etc. in Vicinae and open them instantly
- **No Configuration UI**: Directories are defined in code for version control
- **Simple Generation**: Edit one config, regenerate everything
- **File Manager Integration**: Auto-detects nemo, nautilus, dolphin, thunar, or pcmanfm
- **Performance**: Caches file manager detection (24-hour cache)
- **Icon Theme Support**: Uses freedesktop icon names (resolves from Vicinae's selected theme)
- **NixOS Compatible**: Uses `which` instead of hardcoded `/usr/bin/` paths

## How It Works

Each directory gets its own command in Vicinae's global search:
- Type "Downloads" → Opens ~/Downloads immediately
- Type "Dotfiles" → Opens ~/dotfiles immediately
- No need to enter an extension first!

## Adding/Removing Directories

1. **Edit** `scripts/generate.js` and modify the `DIRECTORIES` array:
   ```javascript
   const DIRECTORIES = [
     { 
       name: "downloads",           // Unique ID (used in filename)
       title: "Downloads",          // Display name in Vicinae
       path: "~/Downloads",         // Path (supports ~ expansion)
       icon: "folder-download"      // Freedesktop icon name
     },
     { name: "projects", title: "Projects", path: "~/Projects", icon: "folder-development" },
     // Add more here...
   ];
   ```

2. **Generate** command files:
   ```bash
   npm run generate
   ```

3. **Build** the extension:
   ```bash
   npm run build
   ```

The generator automatically:
- Creates individual command files (`open-downloads.ts`, `open-documents.ts`, etc.)
- Updates `package.json` with all commands
- Keeps everything in sync

**Common icons:** `folder-download`, `folder-documents`, `folder-pictures`, `folder-music`, `folder-videos`, `folder-git`, `folder-development`, `folder-root`, `user-desktop`, `user-home`

See [freedesktop icon naming spec](https://specifications.freedesktop.org/icon-naming-spec/latest/ar01s04.html) for more.

## Usage

1. Open Vicinae (global search)
2. Type the directory name (e.g., "Downloads")
3. Press Enter → Directory opens in your file manager

That's it!

## Technical Details

- **Mode**: `no-view` - Commands execute instantly without showing a view
- **Caching**: File manager detection cached for 24 hours (speeds up subsequent opens)
- **File Manager Priority**: nemo → nautilus → dolphin → thunar → pcmanfm
- **Path Expansion**: Supports `~` for home directory
- **Error Handling**: Shows toast notifications for missing directories or file managers

## File Structure

```
favorite-directories/
├── src/
│   ├── open-downloads.ts      # Auto-generated command files
│   ├── open-documents.ts
│   ├── open-pictures.ts
│   ├── ...
│   ├── utils.ts               # Core logic (openDirectory)
│   ├── filesystem.ts          # File manager detection
│   ├── cache.ts               # File manager caching
│   └── types.ts               # Type definitions
├── scripts/
│   └── generate.js            # Directory config & generator
├── package.json               # Auto-updated with commands
└── README.md
```
