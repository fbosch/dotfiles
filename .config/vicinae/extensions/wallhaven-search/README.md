# Wallhaven Search Extension

Search and browse wallpapers from [Wallhaven.cc](https://wallhaven.cc) directly in Vicinae.

## Features

- ?? Search wallpapers by keyword
- ??? Grid view with thumbnail previews (edge-to-edge with rounded corners)
- ?? Filter by category (General, Anime, People)
- ?? Configurable preferences (content purity, sorting, time range)
- ??? Full-size preview when selecting wallpapers
- ?? View favorites and view counts
- ?? Copy wallpaper URLs
- ?? Open in browser
- ?? Download original images

## Preferences

Configure default search settings in the extension preferences:

- **Content Purity**: SFW Only or SFW + Sketchy
- **Default Sorting**: Top List, Most Recent, Most Views, Most Favorites, Relevance, or Random
- **Top Range**: Time range for top list sorting (Last Day to Last Year)

## Usage

1. Install dependencies: `npm install`
2. Run in dev mode: `npm run dev`
3. Search for wallpapers using the search bar
4. Use the category dropdown to filter by General, Anime, or People
5. Browse results in a 3-column grid
6. Press **Enter** to see full-size preview

## Actions

- **Enter**: Show full-size preview
- **Cmd+O**: Open wallpaper page in browser
- **Cmd+C**: Copy image URL
- **Cmd+Shift+C**: Copy page URL
- **Cmd+D**: Download original image

## API Options

The extension uses the Wallhaven API with support for:

- **Categories**: Filter between General (100), Anime (010), People (001), or combinations
- **Purity**: SFW content filtering (configurable in preferences)
- **Sorting**: Multiple sorting options including toplist, recent, views, favorites, relevance, and random
- **Top Range**: Time-based filtering for toplist results

## Build

To build for production:

```bash
npm run build
```
