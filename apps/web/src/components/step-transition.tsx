import { type ReactNode, useEffect, useRef } from "react";

/**
 * Slides the entering step in by navigation direction (forward = from the
 * right, back = from the left). A keyed remount replays the CSS enter
 * animation; the previous step unmounts instantly, so the live chat never
 * mounts before it's shown.
 */
export function StepTransition({
	children,
	step,
}: {
	children: ReactNode;
	step: number;
}) {
	const prevStep = useRef(-1);
	const dir = step >= prevStep.current ? "forward" : "back";
	useEffect(() => {
		prevStep.current = step;
	});
	return (
		<div className="t-steps">
			<div className="t-step t-step-enter" data-dir={dir} key={step}>
				{children}
			</div>
		</div>
	);
}
