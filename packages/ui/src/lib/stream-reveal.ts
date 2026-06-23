export interface RevealFrame {
	reasoning: string;
	text: string;
}

export interface StreamRevealOptions {
	/** 注入用于测试；默认 cancelAnimationFrame。 */
	cancelFrame?: (handle: number) => void;
	/** 缓冲很大时，最多用多少帧追平，避免长回复揭示严重滞后。 */
	catchUpFrames?: number;
	/** 每帧至少揭示的字符数（text 与 reasoning 各自推进）。 */
	charsPerFrame?: number;
	/** 每帧回调，给出当前应显示的 text/reasoning 前缀。 */
	onFrame: (frame: RevealFrame) => void;
	/** 注入用于测试；默认 requestAnimationFrame。 */
	requestFrame?: (cb: () => void) => number;
}

export interface StreamReveal {
	/** 立即揭示全部并触发一次最终 onFrame，停止循环。 */
	flush(): void;
	pushReasoning(delta: string): void;
	pushText(delta: string): void;
	/** 停止循环、不再回调（用于中止）。 */
	stop(): void;
}

const DEFAULT_CHARS_PER_FRAME = 2;
const DEFAULT_CATCH_UP_FRAMES = 8;
const FRAME_FALLBACK_MS = 16;

const defaultRequestFrame = (cb: () => void): number =>
	typeof requestAnimationFrame === "undefined"
		? (setTimeout(cb, FRAME_FALLBACK_MS) as unknown as number)
		: requestAnimationFrame(cb);

const defaultCancelFrame = (handle: number): void => {
	if (typeof cancelAnimationFrame === "undefined") {
		clearTimeout(handle);
	} else {
		cancelAnimationFrame(handle);
	}
};

// Advance `shown` toward `targetLength` by at least `minStep` chars, more when
// far behind, so a large buffer is caught up within ~`catchUpFrames` frames.
function revealStep(
	shown: number,
	targetLength: number,
	minStep: number,
	catchUpFrames: number
): number {
	const remaining = targetLength - shown;
	if (remaining <= 0) {
		return shown;
	}
	const adaptive = Math.max(minStep, Math.ceil(remaining / catchUpFrames));
	return Math.min(targetLength, shown + adaptive);
}

/**
 * Reveals streamed text one chunk per animation frame instead of one DOM
 * update per network token. Bursty/fast deltas are buffered and revealed at a
 * steady cadence (a smoothStream-style typing effect); a long reply never lags
 * more than ~catchUpFrames behind. Reveals by character so CJK stays smooth.
 */
class RevealController implements StreamReveal {
	private targetText = "";
	private targetReasoning = "";
	private shownText = 0;
	private shownReasoning = 0;
	private handle: number | null = null;
	private readonly minStep: number;
	private readonly catchUpFrames: number;
	private readonly onFrame: (frame: RevealFrame) => void;
	private readonly requestFrame: (cb: () => void) => number;
	private readonly cancelFrame: (handle: number) => void;

	constructor(options: StreamRevealOptions) {
		this.minStep = Math.max(
			1,
			options.charsPerFrame ?? DEFAULT_CHARS_PER_FRAME
		);
		this.catchUpFrames = Math.max(
			1,
			options.catchUpFrames ?? DEFAULT_CATCH_UP_FRAMES
		);
		this.onFrame = options.onFrame;
		this.requestFrame = options.requestFrame ?? defaultRequestFrame;
		this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
	}

	private caughtUp(): boolean {
		return (
			this.shownText >= this.targetText.length &&
			this.shownReasoning >= this.targetReasoning.length
		);
	}

	private emit(): void {
		this.onFrame({
			text: this.targetText.slice(0, this.shownText),
			reasoning: this.targetReasoning.slice(0, this.shownReasoning),
		});
	}

	private cancel(): void {
		if (this.handle !== null) {
			this.cancelFrame(this.handle);
			this.handle = null;
		}
	}

	private schedule(): void {
		if (this.handle === null && !this.caughtUp()) {
			this.handle = this.requestFrame(this.tick);
		}
	}

	private readonly tick = (): void => {
		this.handle = null;
		this.shownText = revealStep(
			this.shownText,
			this.targetText.length,
			this.minStep,
			this.catchUpFrames
		);
		this.shownReasoning = revealStep(
			this.shownReasoning,
			this.targetReasoning.length,
			this.minStep,
			this.catchUpFrames
		);
		this.emit();
		this.schedule();
	};

	pushText(delta: string): void {
		this.targetText += delta;
		this.schedule();
	}

	pushReasoning(delta: string): void {
		this.targetReasoning += delta;
		this.schedule();
	}

	flush(): void {
		this.cancel();
		this.shownText = this.targetText.length;
		this.shownReasoning = this.targetReasoning.length;
		this.emit();
	}

	stop(): void {
		this.cancel();
	}
}

export function createStreamReveal(options: StreamRevealOptions): StreamReveal {
	return new RevealController(options);
}
