"use client";

import { cn } from "@better-agent/ui/lib/utils";
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

export interface ArrowBigRightDashIconHandle {
	startAnimation: () => void;
	stopAnimation: () => void;
}

interface ArrowBigRightDashIconProps extends HTMLAttributes<HTMLDivElement> {
	size?: number;
}

const DASH_VARIANTS: Variants = {
	normal: { translateX: 0 },
	animate: {
		translateX: [0, 1, 0],
		transition: {
			duration: 0.4,
		},
	},
};

const ARROW_VARIANTS: Variants = {
	normal: { translateX: 0 },
	animate: {
		translateX: [0, 3, 0],
		transition: {
			duration: 0.4,
		},
	},
};

// Extracted so the forwardRef component stays under the max-lines-per-function
// limit. Decorative — the parent element carries the accessible label.
function ArrowBigRightDashSvg({
	size,
	controls,
}: {
	size: number;
	controls: ReturnType<typeof useAnimation>;
}) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height={size}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<motion.path animate={controls} d="M5 9v6" variants={DASH_VARIANTS} />
			<motion.path
				animate={controls}
				d="M9 9h3V5l7 7-7 7v-4H9V9z"
				variants={ARROW_VARIANTS}
			/>
		</svg>
	);
}

const ArrowBigRightDashIcon = forwardRef<
	ArrowBigRightDashIconHandle,
	ArrowBigRightDashIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
	const controls = useAnimation();
	const isControlledRef = useRef(false);

	useImperativeHandle(ref, () => {
		isControlledRef.current = true;
		return {
			startAnimation: () => controls.start("animate"),
			stopAnimation: () => controls.start("normal"),
		};
	});

	const handleMouseEnter = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (isControlledRef.current) {
				onMouseEnter?.(e);
			} else {
				controls.start("animate");
			}
		},
		[controls, onMouseEnter]
	);

	const handleMouseLeave = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (isControlledRef.current) {
				onMouseLeave?.(e);
			} else {
				controls.start("normal");
			}
		},
		[controls, onMouseLeave]
	);

	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: hover drives a visual animation only; interactivity lives on the parent element
		// biome-ignore lint/a11y/noStaticElementInteractions: hover drives a visual animation only; interactivity lives on the parent element
		<div
			className={cn(className)}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			{...props}
		>
			<ArrowBigRightDashSvg controls={controls} size={size} />
		</div>
	);
});

ArrowBigRightDashIcon.displayName = "ArrowBigRightDashIcon";

export { ArrowBigRightDashIcon };
