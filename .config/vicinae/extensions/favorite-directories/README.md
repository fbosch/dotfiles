# Favorite Directories Extension

Quickly access your favorite directories directly from Vicinae's global search.

## Features

- **Direct Access**: Type "Downloads", "Documents", etc. in Vicinae and open them instantly
- **No Configuration UI**: Directories are defined in code for version control
- **Simple Generation**: Edit one config, regenerate everything
- **File Manager Integration**: Opens directories in your system's file manager

## How It Works

Each directory gets its own command in Vicinae's global search:
- Type "Downloads" → Opens ~/Downloads immediately
- Type "Dotfiles" → Opens ~/dotfiles immediately
- No need to enter an extension first!

## Adding/Removing Directories

1. **Edit** `scripts/generate.js` and modify the `DIRECTORIES` array:
   ```javascript
   const DIRECTORIES = [
     { name: "downloads", title: "Downloads", path: "~/Downloads" },
     { name: "projects", title: "Projects", path: "~/Projects" },
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
- Creates individual command files (open-downloads.ts, open-documents.ts, etc.)
- Updates package.json with all commands
- Keeps everything in sync

## Usage

1. Open Vicinae
2. Type the directory name (e.g., "Downloads")
3. Press Enter → Directory opens in your file manager

That's it!
