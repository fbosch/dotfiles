import { showToast, Toast, Application } from "@vicinae/api";

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * Downloads a wallpaper from the given URL to the specified directory
 * @param url - The URL of the wallpaper to download
 * @param id - The wallpaper ID for naming
 * @param resolution - The wallpaper resolution for naming
 * @param downloadDir - The directory to save the file (defaults to ~/Pictures/Wallpapers)
 * @returns Promise with download result
 */
export async function downloadWallpaper(
  url: string,
  id: string,
  resolution: string,
  downloadDir?: string,
): Promise<DownloadResult> {
  try {
    // Extract file extension from URL
    const urlParts = url.split(".");
    const extension = urlParts[urlParts.length - 1].split("?")[0] || "jpg";

    // Generate filename: wallhaven-{id}-{resolution}.{ext}
    const sanitizedResolution = resolution.replace(/[^a-zA-Z0-9]/g, "x");
    const filename = `wallhaven-${id}-${sanitizedResolution}.${extension}`;

    // Default download directory
    const defaultDir = downloadDir || "~/Pictures/Wallpapers";

    // Expand ~ to home directory
    const expandedDir = defaultDir.replace(
      /^~/,
      process.env.HOME || process.env.USERPROFILE || "",
    );

    const filePath = `${expandedDir}/${filename}`;

    // Show loading toast
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Downloading wallpaper...",
      message: filename,
    });

    // Fetch the image
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get image data as array buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try to use Node.js fs module
    try {
      // Dynamic import to handle environments without fs
      const fs = await import("fs/promises");
      const path = await import("path");

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file
      await fs.writeFile(filePath, buffer);

      // Update toast to success with action to open file
      toast.style = Toast.Style.Success;
      toast.title = "Wallpaper downloaded!";
      toast.message = `Saved to ${filePath}`;
      toast.primaryAction = {
        title: "Open",
        onAction: async () => {
          try {
            await Application.open(filePath);
          } catch (err) {
            console.error("Failed to open file:", err);
          }
        },
      };
      await toast.show();

      // Automatically open the downloaded image in default viewer
      try {
        await Application.open(filePath);
      } catch (err) {
        console.error("Failed to auto-open file:", err);
        // Don't fail the download if we can't open the file
      }

      return {
        success: true,
        filePath,
      };
    } catch (fsError) {
      // fs module not available or write failed
      console.error("Filesystem access failed:", fsError);

      // Try alternative: create blob URL and trigger download via browser
      // This won't work in all environments but worth trying
      try {
        const blob = new Blob([buffer], { type: response.headers.get("content-type") || "image/jpeg" });
        const blobUrl = URL.createObjectURL(blob);

        // Create temporary download link
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

        toast.style = Toast.Style.Success;
        toast.title = "Download started";
        toast.message = `Check your Downloads folder for ${filename}`;
        await toast.show();

        return {
          success: true,
          filePath: `Downloads/${filename}`,
        };
      } catch (blobError) {
        console.error("Blob download failed:", blobError);
        throw new Error(
          "Direct download not supported. Please use 'Download in Browser' instead.",
        );
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await showToast({
      style: Toast.Style.Failure,
      title: "Download failed",
      message: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Gets the file extension from a URL
 */
function getFileExtension(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([^.]+)$/);
    return match ? match[1] : "jpg";
  } catch {
    return "jpg";
  }
}
