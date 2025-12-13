import type { ReactNode } from "react";

interface DesktopProps {
  children: ReactNode;
  /**
   * Minimum height of the desktop viewport
   * @default '80vh'
   */
  minHeight?: string;
  /**
   * Background color matching Zenwritten Dark theme
   * @default '#191919' (from Zenwritten Dark base color)
   */
  backgroundColor?: string;
  /**
   * Use wallpaper background instead of solid color
   * @default true
   */
  useWallpaper?: boolean;
}

/**
 * Desktop wrapper component that replicates the Hyprland desktop environment
 * with Zenwritten Dark theme colors and styling.
 *
 * Use this as a decorator in Storybook stories to preview components
 * in a realistic desktop context.
 */
export function Desktop({
  children,
  minHeight = "100vh",
  backgroundColor = "#191919",
  useWallpaper = true,
}: DesktopProps) {
  return (
    <div
      style={{
        minHeight,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        backgroundColor,
        backgroundImage: useWallpaper ? "url(/wallpaper.png)" : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        padding: 0,
        margin: 0,
      }}
    >
      <div style={{ width: "100%" }}>{children}</div>
    </div>
  );
}
