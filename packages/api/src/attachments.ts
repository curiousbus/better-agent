/* eslint-disable no-magic-numbers -- this file matches binary magic-byte image signatures, which are inherently numeric literals */
import { ORPCError } from "@orpc/server";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_NAME_LEN = 200;

const ALLOWED_IMAGE_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

export const uploadAttachmentInput = z.object({
	sessionId: z.uuid(),
	file: z.instanceof(File),
});

export const attachmentIdInput = z.object({ id: z.uuid() });

function matchesAt(bytes: Uint8Array, sig: number[], offset: number): boolean {
	return sig.every((byte, i) => bytes[offset + i] === byte);
}

// Leading-byte signatures for each allowed image type. WebP is "RIFF????WEBP".
const SIGNATURES: Array<{ mime: string; offset: number; sig: number[] }> = [
	{ mime: "image/png", offset: 0, sig: [0x89, 0x50, 0x4e, 0x47] },
	{ mime: "image/jpeg", offset: 0, sig: [0xff, 0xd8, 0xff] },
	{ mime: "image/gif", offset: 0, sig: [0x47, 0x49, 0x46] },
];

/** Detect the real image type from the leading bytes (defends against a forged
 * Content-Type). Returns the sniffed mime, or null if it's not a known image. */
function sniffImageMime(bytes: Uint8Array): string | null {
	for (const { mime, sig, offset } of SIGNATURES) {
		if (matchesAt(bytes, sig, offset)) {
			return mime;
		}
	}
	const isWebp =
		matchesAt(bytes, [0x52, 0x49, 0x46, 0x46], 0) &&
		matchesAt(bytes, [0x57, 0x45, 0x42, 0x50], 8);
	return isWebp ? "image/webp" : null;
}

export interface ValidatedUpload {
	data: Uint8Array;
	mime: string;
	name: string;
}

/** Wrap raw bytes as a File for an oRPC binary response (copies into a definite
 * ArrayBuffer so the type is a valid BlobPart). */
export function bytesToFile(
	bytes: Uint8Array,
	name: string,
	mime: string
): File {
	const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
	copy.set(bytes);
	return new File([copy], name, { type: mime });
}

/** Validate an uploaded image: allowed type, size cap, and that the bytes
 * actually match the claimed type. Throws ORPCError(BAD_REQUEST) otherwise. */
export async function validateImageUpload(
	file: File
): Promise<ValidatedUpload> {
	if (!ALLOWED_IMAGE_MIME.has(file.type)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Only PNG, JPEG, WebP, or GIF images are allowed",
		});
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Image too large (max 8 MB)",
		});
	}
	const data = new Uint8Array(await file.arrayBuffer());
	if (sniffImageMime(data) !== file.type) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Image content does not match its declared type",
		});
	}
	return {
		data,
		mime: file.type,
		name: file.name.slice(0, MAX_NAME_LEN) || "image",
	};
}
