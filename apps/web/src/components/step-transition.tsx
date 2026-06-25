import { PageTransition } from "@better-agent/ui/components/page-transition";
import { type ReactNode, useEffect, useRef } from "react";

/** Wraps the home flow (grid -> composer -> chat) in a directional slide. */
export function StepTransition({
	children,
	step,
}: {
	children: ReactNode;
	step: number;
}) {
	const prevStep = useRef(step);
	const direction = step >= prevStep.current ? 1 : -1;
	useEffect(() => {
		prevStep.current = step;
	});
	return (
		<PageTransition animationKey={step} direction={direction}>
			{children}
		</PageTransition>
	);
}
