// ---------------------------------------------------------------------------
// Safe path helpers (shared utilities for x-normalize)
// ---------------------------------------------------------------------------

export type AnyRecord = Record<string, unknown>;

export function asRecord(v: unknown): AnyRecord | null {
	return typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as AnyRecord)
		: null;
}

/** Read a dot-separated path from an object without throwing. */
export function readPath(obj: unknown, path: string): unknown {
	const parts = path.split(".");
	let cur: unknown = obj;
	for (const key of parts) {
		const rec = asRecord(cur);
		if (rec === null) {
			return null;
		}
		cur = rec[key];
	}
	return cur;
}

/** Return string value, or null for empty/missing. */
export function asString(v: unknown): string | null {
	if (typeof v === "string" && v.length > 0) {
		return v;
	}
	return null;
}

/** Parse a number from a value that may be a numeric string. Returns defaultVal when missing/invalid. */
export function asNumber(v: unknown, defaultVal: number): number;
export function asNumber(v: unknown, defaultVal: null): number | null;
export function asNumber(v: unknown, defaultVal: number | null): number | null {
	if (typeof v === "number" && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === "string") {
		const n = Number(v);
		if (Number.isFinite(n)) {
			return n;
		}
	}
	return defaultVal;
}

export function asBoolean(v: unknown): boolean {
	return v === true;
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

export interface Mp4Variant {
	bitrate: number | null;
	url: string;
}

/** Pick the highest-bitrate video/mp4 variant, or null if none exist. */
export function pickBestMp4(variants: unknown): Mp4Variant | null {
	if (!Array.isArray(variants)) {
		return null;
	}
	let best: Mp4Variant | null = null;
	for (const v of variants) {
		const rec = asRecord(v);
		if (!rec) {
			continue;
		}
		if (rec.content_type !== "video/mp4") {
			continue;
		}
		const url = asString(rec.url);
		if (!url) {
			continue;
		}
		const bitrate = asNumber(rec.bitrate, null);
		if (best === null || (bitrate ?? -1) > (best.bitrate ?? -1)) {
			best = { bitrate, url };
		}
	}
	return best;
}
