// Types related to Wallhaven API and extension preferences

export type Preferences = {
  apiKey?: string;
  useUserSettings: boolean;
  purity: string;
  sorting: string;
  topRange: string;
  downloadDirectory: string;
  hyprpaperConfigPath: string;
};

export type UserSettings = {
  purity: string[];
  categories: string[];
  toplist_range: string;
  resolutions: string[];
  aspect_ratios: string[];
  ai_art_filter: number;
};

export type Wallpaper = {
  id: string;
  url: string;
  short_url: string;
  views: number;
  favorites: number;
  resolution: string;
  colors: string[];
  path: string;
  category: string;
  purity: string;
  file_size: number;
  file_type?: string;
  created_at?: string;
  ratio?: string;
  source?: string;
  uploader?: {
    username: string;
    group: string;
  };
  tags: Array<{
    id: number;
    name: string;
    category?: string;
    purity?: string;
  }>;
  thumbs: {
    large: string;
    original: string;
    small: string;
  };
};

export type WallhavenResponse = {
  data: Wallpaper[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
};

export type SearchParams = {
  query: string;
  categories: string;
  purity: string;
  sorting: string;
  topRange?: string;
  page: number;
  apiKey?: string;
  resolutions?: string[];
  aspectRatios?: string[];
  aiArtFilter?: number;
};
