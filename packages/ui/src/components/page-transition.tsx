import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

const SLIDE = 40;

const variants = {
	enter: (dir: number) => ({ opacity: 0, x: dir * SLIDE, filter: "blur(4px)" }),
	center: { opacity: 1, x: 0, filter: "blur(0px)" },
	exit: (dir: number) => ({ opacity: 0, x: dir * -SLIDE, filter: "blur(4px)" }),
};

/**
 * Slides the keyed content in/out on change. `direction` 1 = forward (new from
 * the right), -1 = back (new from the left). The previous child fully exits
 * before the next enters (`mode="wait"`), so live children never overlap.
 */
export function PageTransition({
	animationKey,
	children,
	direction = 1,
}: {
	animationKey: string | number;
	children: ReactNode;
	direction?: number;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AnimatePresence custom={direction} initial={false} mode="wait">
				<motion.div
					animate="center"
					className="flex min-h-0 flex-1 flex-col"
					custom={direction}
					exit="exit"
					initial="enter"
					key={animationKey}
					transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
					variants={variants}
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
