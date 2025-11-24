/**
 * Creates an SVG data URL that wraps an image with rounded corners
 * @param imageUrl - The URL of the image to wrap
 * @param width - Width of the SVG (default: 400)
 * @param height - Height of the SVG (default: 225, for 16:9 aspect ratio)
 * @param radius - Corner radius (default: 12)
 * @returns SVG data URL string
 */
export function createRoundedImageSVG(
  imageUrl: string,
  width: number = 400,
  height: number = 225,
  radius: number = 12,
): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <clipPath id="rounded-corners">
          <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/>
        </clipPath>
      </defs>
      <image 
        href="${imageUrl}" 
        width="${width}" 
        height="${height}" 
        clip-path="url(#rounded-corners)"
        preserveAspectRatio="xMidYMid slice"
      />
    </svg>
  `.trim();

  return "data:image/svg+xml," + encodeURIComponent(svg);
}
