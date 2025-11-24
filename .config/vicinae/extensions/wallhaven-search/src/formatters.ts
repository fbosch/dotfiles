import { Color } from "@vicinae/api";
import type { Wallpaper } from "./types";

export function getTagColor(category?: string): Color {
  if (!category) return Color.Blue;
  const categoryColors: Record<string, Color> = {
    "Anime & Manga": Color.Magenta,
    People: Color.Orange,
    Landscapes: Color.Green,
    Nature: Color.Green,
    Plants: Color.Green,
    Architecture: Color.Purple,
    Animals: Color.Yellow,
    Fantasy: Color.Magenta,
    Vehicles: Color.Red,
    Technology: Color.Blue,
  };
  return categoryColors[category] || Color.Blue;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export function formatDate(dateString?: string): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function formatFileType(fileType?: string): string | null {
  if (!fileType) return null;
  return fileType.replace("image/", "").toUpperCase();
}

export function buildMetadataSubtitle(wallpaper: Wallpaper): string {
  return `★ ${wallpaper.favorites.toLocaleString()} favorites · ${wallpaper.views.toLocaleString()} views`;
}
