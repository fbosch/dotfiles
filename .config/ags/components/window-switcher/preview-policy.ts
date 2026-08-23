const previewHeight = 180;
const previewMaxWidth = 320;
const previewMinWidth = 30;

export function fallbackPreviewDimensions(size?: {
	width: number;
	height: number;
}): { width: number; height: number } {
	if (!size || size.width <= 0 || size.height <= 0)
		return { width: previewMinWidth, height: previewHeight };

	return scaledPreviewDimensions(size.width, size.height);
}

export function scaledPreviewDimensions(
	imageWidth: number,
	imageHeight: number,
): { width: number; height: number } {
	const aspectRatio = imageWidth / imageHeight;
	let height = previewHeight;
	let width = Math.round(height * aspectRatio);
	if (width > previewMaxWidth) {
		width = previewMaxWidth;
		height = Math.round(width / aspectRatio);
	}
	return { width: Math.max(previewMinWidth, width), height };
}
