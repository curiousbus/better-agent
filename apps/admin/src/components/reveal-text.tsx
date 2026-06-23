import { cn } from "@better-agent/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";

/**
 * Plays the transitions.dev "texts reveal" stagger on mount. Wrap a headline +
 * supporting line and tag them with `t-stagger-line t-stagger-line--1/2`.
 */
export function RevealText({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setShown(true));
		return () => cancelAnimationFrame(id);
	}, []);
	return (
		<div className={cn("t-stagger", shown && "is-shown", className)}>
			{children}
		</div>
	);
}
