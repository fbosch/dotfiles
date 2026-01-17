# ClamAV Scanner

A Vicinae extension for manually scanning files and directories for viruses using ClamAV.

## Features

- **Quick Scan**: Scan common directories (Home, Downloads, Documents, Desktop) with one click
- **Custom Path Scanning**: Enter any path to scan specific files or directories
- **Detailed Results**: View infected files, virus names, and scan statistics
- **Virus Database Updates**: Update definitions directly from Vicinae using freshclam
- **Configurable Options**: 
  - Recursive scanning
  - Show infected files only
  - Auto-remove infected files (use with caution!)
  - Exclude patterns using regex
- **No-View Quick Scan**: Fast home directory scan with HUD notification

## Requirements

- **ClamAV** must be installed on your system
- **Virus database** must be downloaded (run `freshclam` to update)

### Installation (NixOS/Nix)

```bash
nix-env -iA nixpkgs.clamav
```

### Initial Setup - Download Virus Definitions

**IMPORTANT:** Before you can scan, you must download the virus database first!

**Option 1: Use the extension (Recommended)**
1. Restart Vicinae to load the extension
2. Search for "Update Virus Database"
3. Run the command
4. Wait for the ~200MB download to complete

The extension will automatically:
- Create `~/.clamav/` directory
- Generate a minimal freshclam config
- Download virus definitions to your home directory
- No sudo/root permissions required!

**Option 2: Manual terminal command**
```bash
mkdir -p ~/.clamav
cat > ~/.clamav/freshclam.conf << 'EOF'
DatabaseMirror database.clamav.net
DatabaseDirectory $HOME/.clamav
UpdateLogFile $HOME/.clamav/freshclam.log
LogVerbose yes
LogTime yes
EOF

freshclam --config-file=$HOME/.clamav/freshclam.conf
```

This downloads the virus definition files (main.cvd, daily.cvd, bytecode.cvd) to `~/.clamav/`. The download is ~200MB and may take a few minutes.

## Commands

### Scan Directory

Interactive directory scanner with visual results.

**Keybindings:**
- `Enter`: Scan selected directory
- `Cmd+Return`: Scan custom path from search bar
- `Cmd+N`: Start new scan (when viewing results)
- `Cmd+O`: Open infected file in file manager
- `Cmd+C`: Copy file path
- `Cmd+Shift+C`: Copy virus name (infected files only)
- `Cmd+,`: Open preferences

### Quick Scan Home

Fast background scan of your home directory with HUD notification. No UI, just results.

### Update Virus Database

Run `freshclam` to update ClamAV virus definitions. Shows progress notification and HUD with results.

**Note:** Depending on your ClamAV configuration, you may need to run `sudo freshclam` manually if this command fails with permission errors.

## Preferences

### Recursive Scanning
Enable to scan subdirectories recursively (default: enabled)

### Show Infected Files Only
Only display infected files in results (default: disabled)

### Auto-Remove Infected Files
**⚠️ DANGEROUS**: Automatically delete infected files without confirmation (default: disabled)

### Exclude Patterns
Comma-separated regex patterns to exclude from scanning
Example: `.*\.log,.*\.tmp,node_modules/.*`

## Usage Tips

1. **First-time setup**: Run "Update Virus Database" command in Vicinae (no sudo required!)
2. **Database location**: Virus definitions are stored in `~/.clamav/` 
3. **Large directories**: Scanning large directories (like `/`) may take a very long time
4. **Exclude patterns**: Use exclude patterns to skip temporary files, logs, or package managers (node_modules, etc.)
5. **Background scans**: Use "Quick Scan Home" for fast scans without interrupting your workflow
6. **Update regularly**: Run "Update Virus Database" periodically to stay protected against new threats

## Security Notes

- ClamAV is open-source antivirus software primarily designed for email scanning
- It's effective at detecting known malware but should be used as part of a layered security approach
- Always keep virus definitions up to date with `freshclam`
- Be cautious with the auto-remove option - verify threats before deletion when possible

## Troubleshooting

### "ClamAV Not Installed" error
Install ClamAV using your package manager:
```bash
nix-env -iA nixpkgs.clamav  # NixOS/Nix
```

### "Virus Database Missing" error
The virus database hasn't been downloaded yet. Use the "Update Virus Database" command in Vicinae (no sudo required!)

### Permission errors
You may need elevated privileges to scan system directories:
```bash
sudo clamscan -r --database=$HOME/.clamav /
```

## Credits

Extension icon uses the official [ClamAV logo](https://commons.wikimedia.org/wiki/File:ClamAV_Logo.png) licensed under GPLv2.

## License

MIT
