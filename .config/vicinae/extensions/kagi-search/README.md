# Kagi Search

Search the web using Kagi search engine directly from Vicinae.

## Features

- Search Kagi without leaving your workflow
- View search results with snippets
- Quick actions: Open in browser, copy URL, copy title
- Related searches for query refinement
- Uses your existing Kagi subscription (free with session token)

## Setup

### 1. Get Your Kagi Session Link

1. Visit [Kagi Settings - User Details](https://kagi.com/settings/user_details)
2. Scroll to the "Session Link" section
3. Copy the entire session link URL (e.g., `https://kagi.com/?token=abc123...`)

### 2. Configure the Extension

1. Open Vicinae settings
2. Navigate to Extensions → Kagi Search
3. Paste the full session link URL into the "Kagi Session Link" field
   - The extension will automatically extract the token from the URL

## Usage

1. Open Vicinae (default: `Cmd+Space`)
2. Type "Search Kagi" or just "kagi" to activate the extension
3. Enter your search query
4. Press `Enter` to open a result in your browser
5. Use keyboard shortcuts for quick actions:
   - `Cmd+C` - Copy URL
   - `Cmd+Shift+C` - Copy title

## Notes

- This extension uses session token authentication (not the paid API)
- Session tokens may expire periodically - just refresh from Kagi settings
- Your Kagi account settings (personalized results, blocked domains, etc.) are respected
- Requires an active Kagi subscription

## Troubleshooting

### "Invalid or expired session token"

Your session token has expired. Follow the setup steps above to get a new one.

### No results showing

- Check that your session token is correctly configured
- Verify your internet connection
- Try a different search query

## Privacy

This extension uses your session token to authenticate with Kagi's web interface. No data is stored or sent to third parties - everything goes directly to Kagi.
