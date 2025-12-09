# Favorite Directories Extension - Quick Start

## What I Created

A Vicinae extension that lets you access your favorite directories directly from the global search.

### Files Structure

```
favorite-directories/
├── scripts/
│   └── generate.js           # Generator script with directory config
├── src/
│   ├── open-downloads.ts     # Generated command files
│   ├── open-documents.ts     # (one per directory)
│   ├── open-pictures.ts
│   ├── open-desktop.ts
│   ├── open-dotfiles.ts
│   ├── utils.ts              # Shared utilities
│   ├── filesystem.ts         # File system helpers
│   └── types.ts              # TypeScript types
├── assets/
│   └── ICON_TODO.md
├── package.json              # Extension manifest (auto-generated)
├── tsconfig.json
└── README.md
```

## Features

1. **Direct Global Search**: Each directory appears as a command in Vicinae
2. **Auto-generation**: Modify one config file, regenerate everything
3. **File Manager Detection**: Auto-detects Nautilus, Dolphin, Thunar, Nemo, PCManFM
4. **Simple Workflow**: Edit → Generate → Build

## Next Steps

### 1. Install Dependencies

```bash
cd ~/.config/vicinae/extensions/favorite-directories
npm install
```

### 2. Build the Extension

```bash
npm run build
```

### 3. Use It!

1. Open Vicinae (usually with a keyboard shortcut)
2. Type "Downloads" or "Documents"
3. Press Enter → directory opens in your file manager

## Customization

### Adding More Directories

Edit `scripts/generate.js` and add to the `DIRECTORIES` array:

```javascript
const DIRECTORIES = [
  { name: "downloads", title: "Downloads", path: "~/Downloads" },
  { name: "documents", title: "Documents", path: "~/Documents" },
  { name: "pictures", title: "Pictures", path: "~/Pictures" },
  { name: "desktop", title: "Desktop", path: "~/Desktop" },
  { name: "dotfiles", title: "Dotfiles", path: "~/dotfiles" },
  
  // Add your custom directories:
  { name: "projects", title: "Projects", path: "~/Projects" },
  { name: "config", title: "Config", path: "~/.config" },
  { name: "work", title: "Work", path: "~/Work" },
];
```

Then regenerate and rebuild:

```bash
npm run generate
npm run build
```

### File Manager Detection

The extension tries these file managers in order:
1. Nautilus (GNOME Files)
2. Dolphin (KDE)
3. Thunar (XFCE)
4. Nemo (Cinnamon)
5. PCManFM (LXDE)

### Terminal Detection

For opening directories in terminal (if you add that feature):
1. foot
2. kitty
3. alacritty
4. wezterm
5. gnome-terminal
6. konsole

## How It Works

The generator script (`scripts/generate.js`):
1. Reads the `DIRECTORIES` config array
2. Generates individual TypeScript command files for each directory
3. Updates `package.json` with command definitions
4. Each command is a "no-view" mode command that runs instantly

When you type a directory name in Vicinae:
- It matches the command title (e.g., "Downloads")
- Runs the corresponding command (e.g., `open-downloads.ts`)
- Opens the directory in your file manager
- Closes Vicinae automatically

## Troubleshooting

### Extension doesn't appear in Vicinae

- Make sure you ran `npm install` and `npm run build`
- Restart Vicinae
- Check Vicinae logs for errors

### Directories don't open

- Check that your file manager is installed
- Verify directory paths exist
- Ensure directories have proper permissions

### After adding directories

- Always run `npm run generate` first
- Then run `npm run build`
- Restart Vicinae if needed

## Integration with Your Dotfiles

Since this is in your dotfiles repo:

1. The extension is version controlled
2. GNU Stow will symlink it automatically
3. Share across machines easily
4. Customize per-machine by editing the config and regenerating

Enjoy instant access to your favorite directories!
