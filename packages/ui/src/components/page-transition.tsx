import { motion } from "motion/react";
import type { ReactNode } from "react";

const SLIDE = 16;
const ENTER_DURATION = 0.22;

/**
 * Enter-only keyed transition: on key change the old content unmounts instantly
 * and the new content slides/fades in. No exit phase on purpose — an exiting
 * AnimatePresence clone renders LIVE children (an <Outlet/> already showing the
 * NEW route), which double-flashes pages and remounts children mid-work.
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
			<motion.div
				animate={{ opacity: 1, x: 0 }}
				className="flex min-h-0 flex-1 flex-col"
				initial={{ opacity: 0, x: direction * SLIDE }}
				key={animationKey}
				transition={{ duration: ENTER_DURATION, ease: [0.22, 1, 0.36, 1] }}
			>
				{children}
			</motion.div>
		</div>
	);
}
