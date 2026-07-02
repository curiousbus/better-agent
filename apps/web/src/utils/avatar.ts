const DICEBEAR_BASE = "https://api.dicebear.com/9.x";

export const agentAvatar = (seed: string): string =>
	`${DICEBEAR_BASE}/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`;

export const userAvatar = (seed: string): string =>
	`${DICEBEAR_BASE}/thumbs/svg?seed=${encodeURIComponent(seed)}`;
