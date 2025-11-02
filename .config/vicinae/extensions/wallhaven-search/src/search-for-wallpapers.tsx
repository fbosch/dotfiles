import React, { useState, useEffect } from 'react';
import { Grid, ActionPanel, Action, showToast, Icon } from '@vicinae/api';

type Wallpaper = {
  id: string;
  url: string;
  short_url: string;
  views: number;
  favorites: number;
  resolution: string;
  colors: string[];
  path: string;
  thumbs: {
    large: string;
    original: string;
    small: string;
  };
};

type WallhavenResponse = {
  data: Wallpaper[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
};

export default function WallhavenSearch() {
  const [searchText, setSearchText] = useState('');
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!searchText) {
      searchWallpapers('nature');
      return;
    }

    const timer = setTimeout(() => {
      searchWallpapers(searchText);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchText]);

  async function searchWallpapers(query: string) {
    setIsLoading(true);
    
    try {
      const response = await fetch(
        `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&sorting=toplist`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: WallhavenResponse = await response.json();
      setWallpapers(data.data);
    } catch (error) {
      showToast({ 
        style: 'failure',
        title: 'Search failed', 
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      setWallpapers([]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Grid
      columns={4}
      isLoading={isLoading}
      searchBarPlaceholder="Search wallpapers..."
      onSearchTextChange={setSearchText}
      throttle
    >
      {wallpapers.map((wallpaper) => (
        <Grid.Item
          key={wallpaper.id}
          content={wallpaper.thumbs.large}
          title={wallpaper.resolution}
          subtitle={`❤️ ${wallpaper.favorites} · 👁️ ${wallpaper.views}`}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser 
                title="Open in Browser" 
                url={wallpaper.short_url} 
              />
              <Action.CopyToClipboard 
                title="Copy URL" 
                content={wallpaper.path} 
              />
              <Action.CopyToClipboard 
                title="Copy Page URL" 
                content={wallpaper.short_url}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              />
              <Action.OpenInBrowser 
                title="Download Original" 
                url={wallpaper.path}
                shortcut={{ modifiers: ['cmd'], key: 'd' }}
              />
            </ActionPanel>
          }
        />
      ))}
    </Grid>
  );
}
