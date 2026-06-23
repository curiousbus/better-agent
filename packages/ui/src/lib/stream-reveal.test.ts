import { expect, it } from "vitest";
import { createStreamReveal, type RevealFrame } from "./stream-reveal";

const LONG_LEN = 90;

// A manual requestAnimationFrame stand-in: stores the pending callback so the
// test can drive frames deterministically instead of relying on real rAF.
function manualRaf() {
	let pending: (() => void) | null = null;
	return {
		request: (cb: () => void) => {
			pending = cb;
			return 1;
		},
		cancel: () => {
			pending = null;
		},
		runFrames: (max = 10_000) => {
			let count = 0;
			while (pending && count < max) {
				const cb = pending;
				pending = null;
				cb();
				count += 1;
			}
			return count;
		},
	};
}

it("reveals progressively over many frames, batching below one-per-char", () => {
	const raf = manualRaf();
	const frames: RevealFrame[] = [];
	const reveal = createStreamReveal({
		charsPerFrame: 3,
		onFrame: (frame) => frames.push(frame),
		requestFrame: raf.request,
		cancelFrame: raf.cancel,
	});
	const full = "x".repeat(LONG_LEN);
	reveal.pushText(full);
	const frameCount = raf.runFrames();
	expect(frameCount).toBeGreaterThan(1);
	expect(frameCount).toBeLessThan(full.length);
	expect(frames.at(-1)?.text).toBe(full);
});

it("accumulates deltas pushed across multiple calls", () => {
	const raf = manualRaf();
	const frames: RevealFrame[] = [];
	const reveal = createStreamReveal({
		charsPerFrame: 2,
		onFrame: (frame) => frames.push(frame),
		requestFrame: raf.request,
		cancelFrame: raf.cancel,
	});
	reveal.pushText("Hello, ");
	reveal.pushText("world!");
	raf.runFrames();
	expect(frames.at(-1)?.text).toBe("Hello, world!");
});

it("reveals text and reasoning independently", () => {
	const raf = manualRaf();
	const frames: RevealFrame[] = [];
	const reveal = createStreamReveal({
		charsPerFrame: 1,
		onFrame: (frame) => frames.push(frame),
		requestFrame: raf.request,
		cancelFrame: raf.cancel,
	});
	reveal.pushReasoning("think");
	reveal.pushText("answer");
	raf.runFrames();
	expect(frames.at(-1)).toEqual({ text: "answer", reasoning: "think" });
});

it("flush reveals everything immediately and cancels pending frames", () => {
	const raf = manualRaf();
	const frames: RevealFrame[] = [];
	const reveal = createStreamReveal({
		charsPerFrame: 1,
		onFrame: (frame) => frames.push(frame),
		requestFrame: raf.request,
		cancelFrame: raf.cancel,
	});
	reveal.pushText("complete");
	reveal.flush();
	expect(frames.at(-1)?.text).toBe("complete");
	expect(raf.runFrames()).toBe(0);
});

it("stop halts further callbacks without revealing the remainder", () => {
	const raf = manualRaf();
	const frames: RevealFrame[] = [];
	const reveal = createStreamReveal({
		charsPerFrame: 1,
		onFrame: (frame) => frames.push(frame),
		requestFrame: raf.request,
		cancelFrame: raf.cancel,
	});
	reveal.pushText("abcdefgh");
	const before = frames.length;
	reveal.stop();
	raf.runFrames();
	expect(frames.length).toBe(before);
});
