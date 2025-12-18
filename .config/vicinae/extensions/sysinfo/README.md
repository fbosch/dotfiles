# System Info

View detailed system information in a beautiful "About This Mac" style interface for Linux systems.

## Features

- **SVG-Based Visual Interface**: Dynamically generated SVG with beautiful cards and visual elements
- **Hardware Overview**: Display CPU, memory, storage, and GPU information
- **Visual Progress Bars**: Animated progress bars with color-coded status indicators
- **Real-time Stats**: Memory and storage usage with live updates
- **Display Information**: Show connected displays with resolution and refresh rate (Hyprland/X11)
- **Auto-refresh**: Optionally refresh stats automatically at configurable intervals
- **Professional Design**: Clean, card-based layout inspired by macOS Big Sur
- **Quick Actions**: Copy hostname, OS info, or full system details to clipboard

## Visual Design

The extension uses a dynamically generated SVG interface featuring:
- Dark theme with Zenwritten Dark color palette
- Smooth animated progress bars
- Card-based layout with rounded corners and subtle borders
- Color-coded indicators (green/yellow/red) for resource usage
- Clean typography and visual hierarchy
- Professional, polished appearance

## Information Displayed

### Overview
- Operating system name and version
- Kernel version
- System architecture
- Uptime

### Hardware
- Computer hostname and model (if available)
- CPU name, cores, and threads
- Current CPU frequency
- Total memory and usage
- Storage devices with usage statistics
- GPU information (via lspci)
- Connected displays with resolution and refresh rate

### Actions
- **Cmd+R**: Refresh system information
- **Cmd+C**: Copy hostname
- **Cmd+Shift+C**: Copy OS info
- **Cmd+Shift+A**: Copy all info as markdown

## Preferences

### Show Distribution Logo
Display ASCII art logo for your Linux distribution (feature in development)

### Auto-refresh Interval
Choose how often to automatically refresh system stats:
- Disabled (manual only)
- Every 5 seconds
- Every 10 seconds
- Every 30 seconds
- Every minute

## Requirements

- Linux system with `/proc` filesystem
- Optional: `lspci` for GPU information
- Optional: Hyprland or X11 for display information

## Notes

This extension is designed for Linux systems and gathers information from standard system files and commands. Some information (like model name or display details) may not be available on all systems, particularly in VMs or headless setups.
