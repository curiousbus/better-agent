export interface RateLimiter {
	/** Records a hit for `key`; resolves false when the window's limit is exceeded. */
	hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export function createInMemoryRateLimiter(
	now: () => number = () => Date.now()
): RateLimiter {
	const buckets = new Map<string, { count: number; resetAt: number }>();
	return {
		hit(key, limit, windowMs) {
			const t = now();
			const bucket = buckets.get(key);
			if (!bucket || bucket.resetAt <= t) {
				buckets.set(key, { count: 1, resetAt: t + windowMs });
				return Promise.resolve(true);
			}
			bucket.count += 1;
			return Promise.resolve(bucket.count <= limit);
		},
	};
}
