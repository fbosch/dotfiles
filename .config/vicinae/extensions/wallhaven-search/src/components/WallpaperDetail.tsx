import { Detail, ActionPanel, Action, Icon, getPreferenceValues } from "@vicinae/api";
import { useQuery } from "@tanstack/react-query";
import type { Wallpaper, Preferences } from "../types";
import { fetchWallpaperDetails } from "../api";
import { WallpaperMetadata } from "./WallpaperMetadata";
import { downloadWallpaper } from "../utils/download";

export function WallpaperDetail({ wallpaper }: { wallpaper: Wallpaper }) {
  const preferences = getPreferenceValues<Preferences>();
  const { data: fullWallpaper, isLoading } = useQuery({
    queryKey: ["wallpaper-detail", wallpaper.id],
    queryFn: () => fetchWallpaperDetails(wallpaper.id, preferences.apiKey),
  });

  const handleDownload = async () => {
    const w = fullWallpaper || wallpaper;
    await downloadWallpaper(w.path, w.id, w.resolution, preferences.downloadDirectory);
  };

  const displayWallpaper = fullWallpaper || wallpaper;
  const markdown = `<img src="${wallpaper.thumbs.large}" alt="Wallpaper" style="max-width: 100%; height: auto; object-fit: contain;" />`;

  return (
    <Detail
      markdown={markdown}
      metadata={<WallpaperMetadata wallpaper={displayWallpaper} />}
      actions={
        <ActionPanel>
          <Action
            title="Download Wallpaper"
            icon={Icon.Download}
            onAction={handleDownload}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
          />
          <ActionPanel.Section>
            <Action.OpenInBrowser title="Open in Browser" url={displayWallpaper.short_url} />
            <Action.CopyToClipboard title="Copy Image URL" content={displayWallpaper.path} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
