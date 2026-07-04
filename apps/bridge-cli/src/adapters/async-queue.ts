// A minimal push-based async queue: producers call `push`/`close`, consumers
// pull via the standard `for await` protocol. Used to turn readline "line"
// events (callback-based) into the `AsyncIterable<NormalizedEvent>` the
// `Adapter` interface requires.

export interface AsyncQueue<T> extends AsyncIterable<T> {
	close(): void;
	push(value: T): void;
}

type PendingResolver<T> = (result: IteratorResult<T>) => void;

export function createAsyncQueue<T>(): AsyncQueue<T> {
	const buffered: T[] = [];
	const waiting: PendingResolver<T>[] = [];
	let closed = false;

	return {
		push(value: T): void {
			if (closed) {
				return;
			}
			const resolver = waiting.shift();
			if (resolver) {
				resolver({ value, done: false });
				return;
			}
			buffered.push(value);
		},

		close(): void {
			if (closed) {
				return;
			}
			closed = true;
			for (const resolver of waiting.splice(0)) {
				resolver({ value: undefined, done: true });
			}
		},

		[Symbol.asyncIterator](): AsyncIterator<T> {
			return {
				next(): Promise<IteratorResult<T>> {
					const value = buffered.shift();
					if (value !== undefined) {
						return Promise.resolve({ value, done: false });
					}
					if (closed) {
						return Promise.resolve({ value: undefined, done: true });
					}
					return new Promise((resolve) => {
						waiting.push(resolve);
					});
				},
			};
		},
	};
}
