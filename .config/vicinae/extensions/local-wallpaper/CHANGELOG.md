# Changelog

## [Unreleased] - Multi-Monitor & Fill Mode Support

### Added
- **Multi-monitor support**: Detect and set wallpapers per monitor or all at once
  - Automatic monitor detection using `hyprctl monitors -j`
  - Monitor selection submenu appears when multiple monitors are detected
  - Option to set wallpaper on "All Monitors" or individual displays
  - Monitor names shown with resolution (e.g., "DP-1 (2560x1440)")
  
- **New utilities**:
  - `src/utils/monitors.ts`: Monitor detection and formatting utilities
    - `getConnectedMonitors()`: Query Hyprland for connected monitors
    - `getMonitorByName()`: Find specific monitor by name
    - `getFocusedMonitor()`: Get currently focused monitor
    - `formatMonitorName()`: Format monitor display name with resolution
  
- **Type definitions**:
  - `Monitor` type: Hyprland monitor information
  - `FillMode` type: Framework for future fill mode support (cover, contain, center, tile, stretch)

### Changed
- **Enhanced hyprpaper.conf management**:
  - `updateHyprpaperConfig()` now accepts optional `monitor` parameter
  - Preserves multiple monitor configurations
  - Maintains all preloaded wallpapers
  - Properly handles per-monitor wallpaper assignments
  
- **Improved wallpaper setting**:
  - `setWallpaper()` accepts optional monitor parameter
  - Toast notifications show which monitor(s) the wallpaper was applied to
  - Better feedback for multi-monitor setups

- **UI enhancements**:
  - Dynamic ActionPanel that adapts to monitor count
  - Single monitor: Direct "Set as Wallpaper" action
  - Multiple monitors: Submenu with monitor selection
  - Monitors loaded on component mount and cached

### Documentation
- Updated README with multi-monitor usage guide
- Added troubleshooting section for multi-monitor issues
- Documented hyprpaper.conf format for multiple monitors
- Added note about future fill mode support

### Technical Details
- Monitors are detected once on mount and stored in component state
- Graceful fallback when `hyprctl` is unavailable (empty monitor list)
- Config parser now handles multiple `preload` and `wallpaper` lines
- Special key `__all__` used internally to represent all monitors

### Future Enhancements
- Fill mode support (pending hyprpaper native support or image preprocessing)
- Monitor hotplug detection and automatic refresh
- Preview showing which wallpaper is set on which monitor
- Ability to set different wallpapers on all monitors at once
