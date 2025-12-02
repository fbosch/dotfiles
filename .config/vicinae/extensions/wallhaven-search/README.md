# Wallhaven Search Extension

Search and browse wallpapers from [Wallhaven.cc](https://wallhaven.cc) directly in Vicinae.

## Features

- ?? Search wallpapers by keyword
- ??? Grid view with thumbnail previews (edge-to-edge display)
- ?? Filter by category (General, Anime, People)
- ?? Configurable preferences (content purity, sorting, time range)
- ?? Optional API key support with user settings sync
- ?? Local storage caching (12 hours) - instant results for recent searches
- ?? Infinite loading - click "Load More" to append more wallpapers
- ??? Full-size preview when selecting wallpapers
- ?? View favorites and view counts
- ?? Copy wallpaper URLs
- ?? Open in browser
- ??? **Direct wallpaper downloads** - Save wallpapers directly to your filesystem with custom directory

## Preferences

Configure default search settings in the extension preferences:

- **API Key**: Optional Wallhaven API key for accessing additional features (get yours at https://wallhaven.cc/settings/account)
- **Use User Settings**: When enabled with an API key, automatically uses your Wallhaven account settings (purity, top range) instead of extension settings
- **Content Purity**: SFW Only or SFW + Sketchy (overridden when "Use User Settings" is enabled)
- **Default Sorting**: Top List, Most Recent, Most Views, Most Favorites, Relevance, or Random
- **Top Range**: Time range for top list sorting (Last Day to Last Year) (overridden when "Use User Settings" is enabled)
- **Download Directory**: Directory where wallpapers will be saved (default: `~/Pictures/Wallpapers`, supports `~` for home directory)
- **Hyprpaper Config Path**: Path to your hyprpaper.conf file for the "Download and Apply" action (default: `~/.config/hypr/hyprpaper.conf`)

### Using Your Wallhaven Account Settings

1. Get your API key from https://wallhaven.cc/settings/account
2. Enter it in the extension preferences
3. Enable "Use User Settings" checkbox
4. The extension will now use your Wallhaven account preferences for purity and top range settings

## Usage

1. Install dependencies: `npm install`
2. Run in dev mode: `npm run dev`
3. Search for wallpapers using the search bar
4. Use the category dropdown to filter by General, Anime, or People
5. Browse results in a 3-column grid (24 wallpapers per page)
6. Scroll to the bottom and press **Enter** on "Load More" to append the next page
7. All loaded wallpapers stay visible - keep loading more to see additional results
8. Press **Enter** on any wallpaper to see full-size preview

## Actions

### On Wallpapers
- **Enter**: Show full-size preview
- **Cmd+D**: Download wallpaper directly to your configured download directory
- **Cmd+S**: Download and apply wallpaper (downloads to directory and sets as desktop background via hyprpaper)
- **Cmd+O**: Open wallpaper page in browser
- **Cmd+C**: Copy image URL
- **Cmd+Shift+C**: Copy page URL
- **Cmd+Shift+S**: Open Wallhaven settings page

### On "Load More" Item
- **Enter**: Load and append next page of wallpapers

## How It Works

The extension uses react-query's `useInfiniteQuery` to efficiently manage wallpaper loading. When you click "Load More", the next page is fetched and appended to your current view. All previously loaded pages remain visible, allowing you to browse through hundreds of wallpapers seamlessly. The section subtitle shows how many wallpapers you've loaded versus the total available.

### Caching & Rate Limiting

The extension implements smart caching and debouncing to respect Wallhaven's 45 requests/minute rate limit:

**Debouncing:**
- Search input is debounced by 800ms
- Prevents rapid-fire API requests while typing
- Only searches after you stop typing for 800ms

**Caching:**
- All queries are cached in localStorage for 12 hours
- Identical searches return instant results (no API call)
- Cache persists across extension restarts
- Cached data automatically expires after 12 hours

**Benefits:**
- Respects Wallhaven API rate limits
- Fast, responsive search experience
- Reduces unnecessary API load
- Works offline for cached searches

## API Options

The extension uses the Wallhaven API with support for:

- **Categories**: Filter between General (100), Anime (010), People (001), or combinations
- **Purity**: SFW content filtering (configurable in preferences)
- **Sorting**: Multiple sorting options including toplist, recent, views, favorites, relevance, and random
- **Top Range**: Time-based filtering for toplist results
- **Infinite Loading**: Seamlessly append pages to browse through thousands of results

## Direct Download Feature

The extension now supports direct wallpaper downloads to your local filesystem:

1. **Configure download directory** in extension preferences (default: `~/Pictures/Wallpapers`)
2. Press **Cmd+D** on any wallpaper to download it directly
3. Files are saved with descriptive names: `wallhaven-{id}-{resolution}.{ext}`
4. Download progress is shown with toast notifications
5. If direct download isn't available in your environment, use the "Download in Browser" fallback action

### Download Behavior

- **Success**: Toast shows "Wallpaper downloaded!" with the file path
- **Failure**: Toast shows error message with details
- **Fallback**: If filesystem access is unavailable, the extension attempts browser-based download
- **Directory creation**: The download directory is created automatically if it doesn't exist

## Build

To build for production:

```bash
npm run build
```
