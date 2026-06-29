// Downscale large images before upload so the model isn't billed for needless
// vision tokens (token cost scales with pixel area). Runs in any browser/worker
// runtime (createImageBitmap + OffscreenCanvas); no-ops in Node and on failure,
// so every agent-client consumer gets it uniformly without bundling an image lib.

const MAX_EDGE = 1568; // Anthropic's recommended max longest edge.
const JPEG_QUALITY = 0.85;

interface ResizeBitmap {
	close(): void;
	height: number;
	width: number;
}
interface ResizeContext {
	drawImage(
		image: ResizeBitmap,
		dx: number,
		dy: number,
		dw: number,
		dh: number
	): void;
}
interface ResizeCanvas {
	convertToBlob(options: { quality?: number; type: string }): Promise<Blob>;
	getContext(contextId: "2d"): ResizeContext | null;
}
interface ResizeGlobals {
	createImageBitmap?: (data: Blob) => Promise<ResizeBitmap>;
	OffscreenCanvas?: new (width: number, height: number) => ResizeCanvas;
}

const JPEG_EXT = /\.jpe?g$/i;
const ANY_EXT = /\.[^.]+$/;

function jpegName(name: string): string {
	return JPEG_EXT.test(name) ? name : `${name.replace(ANY_EXT, "")}.jpg`;
}

/**
 * Resize an image File to {@link MAX_EDGE} on its longest edge and re-encode it.
 * Returns the original unchanged for non-images, GIFs (animation), already-small
 * images, runtimes without the canvas APIs (e.g. Node), or any failure.
 */
export async function downscaleImage(file: File): Promise<File> {
	if (!file.type.startsWith("image/") || file.type === "image/gif") {
		return file;
	}
	const { createImageBitmap, OffscreenCanvas } =
		globalThis as unknown as ResizeGlobals;
	if (!(createImageBitmap && OffscreenCanvas)) {
		return file;
	}
	try {
		const bitmap = await createImageBitmap(file);
		const longest = Math.max(bitmap.width, bitmap.height);
		if (longest <= MAX_EDGE) {
			bitmap.close();
			return file;
		}
		const scale = MAX_EDGE / longest;
		const width = Math.round(bitmap.width * scale);
		const height = Math.round(bitmap.height * scale);
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			bitmap.close();
			return file;
		}
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		// PNG stays PNG (lossless — preserves crisp screenshots/transparency);
		// everything else re-encodes to JPEG to keep the payload small.
		const type = file.type === "image/png" ? "image/png" : "image/jpeg";
		const blob = await canvas.convertToBlob({ type, quality: JPEG_QUALITY });
		const name = type === "image/jpeg" ? jpegName(file.name) : file.name;
		return new File([blob], name, { type });
	} catch {
		return file;
	}
}
