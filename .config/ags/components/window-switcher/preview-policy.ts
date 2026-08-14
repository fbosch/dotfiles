const previewHeight = 180;
const previewMaxWidth = 320;
const previewMinWidth = 30;

export const fallbackPreviewDimensions = {
	width: previewMinWidth,
	height: previewHeight,
};

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
