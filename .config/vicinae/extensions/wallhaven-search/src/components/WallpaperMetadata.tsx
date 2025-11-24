import { Detail } from "@vicinae/api";
import type { Wallpaper } from "../types";
import { getTagColor, formatCategory, formatDate, formatFileType, formatBytes } from "../formatters";

export function WallpaperMetadata({ wallpaper }: { wallpaper: Wallpaper }) {
  return (
    <Detail.Metadata>
      <Detail.Metadata.Label
        title="Resolution"
        text={`${wallpaper.resolution}${wallpaper.ratio ? ` (${wallpaper.ratio})` : ""}`}
      />
      <Detail.Metadata.Label
        title="File"
        text={`${formatBytes(wallpaper.file_size)}${formatFileType(wallpaper.file_type) ? ` · ${formatFileType(wallpaper.file_type)}` : ""}`}
      />
      {wallpaper.tags && wallpaper.tags.length > 0 && (
        <>
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Tags">
            {wallpaper.tags.map((tag) => (
              <Detail.Metadata.TagList.Item
                key={tag.id}
                text={tag.name}
                color={getTagColor(tag.category)}
              />
            ))}
          </Detail.Metadata.TagList>
        </>
      )}
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Category" text={formatCategory(wallpaper.category)} />
      <Detail.Metadata.Label
        title="Stats"
        text={`★ ${wallpaper.favorites.toLocaleString()} favorites · ${wallpaper.views.toLocaleString()} views`}
      />
      {wallpaper.uploader && (
        <Detail.Metadata.Label title="Uploader" text={wallpaper.uploader.username} />
      )}
      {wallpaper.created_at && (
        <Detail.Metadata.Label title="Uploaded" text={formatDate(wallpaper.created_at) || "Unknown"} />
      )}
      {wallpaper.source && (
        <Detail.Metadata.Link title="Source" text={wallpaper.source} target={wallpaper.source} />
      )}
    </Detail.Metadata>
  );
}
