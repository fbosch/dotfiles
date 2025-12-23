# Vicinae Extensions - Agent Guide

## Overview

This directory contains custom Vicinae extensions following consistent patterns for keybindings, actions, and user experience.

**Official Resources:**
- [Vicinae Extensions Store](https://github.com/vicinaehq/extensions) - Official extension repository
- [Vicinae Documentation](https://docs.vicinae.com/extensions/introduction) - Official docs
- [Vicinae API Reference](https://api-reference.vicinae.com) - Complete API documentation
- [Extension Guidelines](https://github.com/vicinaehq/extensions/blob/main/GUIDELINES.md) - Submission requirements

## Keybinding Conventions

**Note:** These conventions are based on common patterns found in the official Vicinae extensions repository and general UI/UX best practices. While not officially mandated, they provide consistency across our custom extensions. Many official extensions use minimal keyboard shortcuts, so these conventions help enhance user experience.

### Primary Actions (No Modifiers or Single Modifier)

These are the most common actions users will take:

- **Default (Enter/Return)**: Primary action (e.g., open, select, apply)
- **`Cmd+D`**: Toggle detail view / Show details
- **`Cmd+S`**: Save / Set / Download and Apply (context-dependent)
- **`Cmd+O`**: Open in external viewer/browser
- **`Cmd+C`**: Copy primary identifier (e.g., App ID, file path, URL)
- **`Cmd+P`**: Open on specific platform (e.g., ProtonDB)
- **`Cmd+T`**: Open in Terminal
- **`Cmd+E`**: Explore/Reveal in parent directory
- **`Cmd+R`**: Refresh/Reload

### Secondary Actions (Cmd+Shift)

These are advanced or alternative versions of primary actions:

- **`Cmd+Shift+C`**: Copy alternative/advanced info (e.g., full path, install command, page URL)
- **`Cmd+Shift+I`**: Copy detailed info (e.g., compatibility info)
- **`Cmd+Shift+S`**: Open in native app (e.g., Steam client) or advanced save/settings
- **`Cmd+Shift+Delete`**: Clear cache/history (destructive, advanced)

### Conditional Keybindings

Some keybindings should only be active in certain contexts to avoid conflicts:

```typescript
// Example: Only show Cmd+P when there's also a detail action
shortcut={
  showDetailsAction ? { modifiers: ["cmd"], key: "p" } : undefined
}
```

This pattern is useful when:
- An action is only available in detail view
- Keybindings might conflict with primary actions
- Context determines which action takes priority

### Destructive Actions

- **`Ctrl+X`**: Delete (dangerous action, requires deliberate modifier)

## Action Ordering

Actions in `ActionPanel` should follow this priority order:

1. **Primary section** (most common actions):
   - Toggle detail view
   - Primary action (open, apply, set)
   - Secondary action (download, open in viewer)
   
2. **Secondary section** (browser/external):
   - Open in browser (platform-specific sites)
   - Open in native app
   
3. **Utility section** (copy actions):
   - Copy primary info
   - Copy secondary info
   - Copy advanced info
   
4. **Management section** (refresh, settings, clear):
   - Refresh/Reload
   - Settings
   - Clear cache/history
   
5. **Destructive section** (last, clearly separated):
   - Delete
   - Remove

## User Experience Patterns

### Notifications

When opening external URLs (browsers or apps):
```typescript
await showToast({
  style: Toast.Style.Success,
  title: "Opening on [Platform]",
  message: item.name,
});
await closeMainWindow();
```

### Error Handling

```typescript
try {
  // operation
} catch (error) {
  await showToast({
    style: Toast.Style.Failure,
    title: "Operation failed",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
```

### Loading States

- Use `isLoading` prop on List/Detail components
- Show loading toast for long operations
- Use React Query for data fetching with appropriate stale times

## Current Extensions

### flathub-search
**Purpose**: Search and browse Flatpak applications

**Keybindings**:
- `Cmd+D`: Toggle detail view
- `Cmd+O`: Open on Flathub (browser, shows notification, closes window)
- `Cmd+C`: Copy App ID
- `Cmd+Shift+C`: Copy install command

### protondb-search
**Purpose**: Search Steam games and check ProtonDB compatibility

**Keybindings**:
- `Cmd+D`: Show game details
- `Cmd+P`: Open on ProtonDB (browser, shows notification, closes window)
- `Cmd+S`: Open on Steam website (browser, shows notification, closes window)
- `Cmd+Shift+S`: Open in Steam app (shows notification, closes window)
- `Cmd+C`: Copy ProtonDB URL
- `Cmd+Shift+I`: Copy compatibility info

### wallhaven-search
**Purpose**: Search and download wallpapers from Wallhaven

**Keybindings**:
- `Cmd+D`: Download wallpaper
- `Cmd+S`: Download and apply wallpaper
- `Cmd+Shift+C`: Copy page URL
- `Cmd+Shift+S`: Open Wallhaven settings

### local-wallpaper
**Purpose**: Browse and manage local wallpapers

**Keybindings**:
- `Cmd+S`: Set as wallpaper
- `Cmd+O`: Open in image viewer
- `Cmd+R`: Refresh wallpapers
- `Ctrl+X`: Delete wallpaper

### nerdfont-search
**Purpose**: Search and copy Nerd Font icons

**Keybindings**:
- Default: Copy icon (multiple formats available)
- `Cmd+Shift+Delete`: Clear recently copied icons

### favorite-directories
**Purpose**: Quick access to frequently used directories

**Keybindings**:
- Default: Open in file manager
- `Cmd+T`: Open in terminal
- `Cmd+C`: Copy path
- `Cmd+Shift+C`: Copy absolute path
- `Cmd+E`: Show in parent directory

## Development Guidelines

### Official Compliance

All extensions must comply with the [official guidelines](https://github.com/vicinaehq/extensions/blob/main/GUIDELINES.md):

**Required:**
- Pass `npx vici lint` validation
- Directory named after `name` field in manifest
- At least one command
- Clear, concise `title` and `description`
- Use `@vicinae/api` as dependency
- Include `extension_icon.png` (512x512, 1:1 aspect ratio)
- Generate `package-lock.json` with npm

**Quality Standards:**
- Proper error handling with user-friendly messages
- Inform users about missing CLI tools
- No silent failures
- Don't duplicate native Vicinae functionality

**Security:**
- Never download arbitrary binaries
- Exceptions require justification during review
- Prompt users to install required CLI tools themselves

### File Structure

```
extension-name/
  assets/
    extension_icon.png     # 512x512 icon
  src/
    components/            # Reusable React components (optional)
    utils/                 # Helper functions (optional)
    extension-name.tsx     # Main entry point
    types.ts              # TypeScript types (optional)
  package.json
  tsconfig.json
  vicinae-env.d.ts
  README.md
```

### Building Extensions

**⚠️ IMPORTANT: Always build extensions individually to save time and avoid unnecessary rebuilds.**

Build a single extension:

```bash
cd .config/vicinae/extensions/extension-name
npm install  # Only needed if dependencies changed
npm run build
```

Only use the bulk build script for fresh system setup or major updates:

```bash
# From dotfiles root - rebuilds ALL extensions (slow!)
./scripts/vicinae-build-extensions.sh
```

### Code Style

- Use TypeScript with strict mode
- Follow React hooks best practices
- Use React Query for API calls and caching
- Prefer `async/await` over `.then()` chains
- Use meaningful variable names
- Add JSDoc comments for complex functions

### Testing

- Test all keyboard shortcuts
- Verify notifications appear and disappear correctly
- Check window closes when expected
- Test error handling with invalid inputs
- Verify caching behavior

## Common Patterns

### React Query Setup

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

### Caching with Vicinae Cache

```typescript
import { Cache } from "@vicinae/api";

const cache = new Cache();
const CACHE_KEY = "extension-data-v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type CachedData = {
  data: YourDataType[];
  cachedAt: number;
};

function getCachedData(): YourDataType[] | null {
  const cached = cache.get(CACHE_KEY);
  if (!cached) return null;
  
  try {
    const data: CachedData = JSON.parse(cached);
    if (Date.now() - data.cachedAt < CACHE_DURATION) {
      return data.data;
    }
    cache.remove(CACHE_KEY);
    return null;
  } catch {
    cache.remove(CACHE_KEY);
    return null;
  }
}

function setCachedData(data: YourDataType[]): void {
  cache.set(
    CACHE_KEY,
    JSON.stringify({ data, cachedAt: Date.now() } satisfies CachedData),
  );
}
```

### Debounced Search

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// Usage
const [searchText, setSearchText] = useState("");
const debouncedSearch = useDebounce(searchText, 500);
```

## Troubleshooting

### Extension not appearing
- Run `./scripts/vicinae-build-extensions.sh`
- Check for build errors in output
- Restart Vicinae

### TypeScript errors
- Ensure `vicinae-env.d.ts` exists
- Run `npm install` in extension directory
- Check `@vicinae/api` version matches

### Actions not triggering
- Verify keyboard shortcut isn't conflicting
- Check console for JavaScript errors
- Ensure `onAction` or `onOpen` callbacks are async

## Resources

- [Vicinae Documentation](https://vicinae.app/docs)
- [Vicinae API Reference](https://vicinae.app/docs/api)
- [React Query Documentation](https://tanstack.com/query/latest)
