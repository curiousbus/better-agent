import { AnimatePresence, motion } from "motion/react";

/**
 * Fixed top bar that runs an indeterminate "streaming" sweep while `active`.
 * Honest indeterminate motion — it never fakes a percentage.
 */
export function TopProgress({ active }: { active: boolean }) {
	return (
		<AnimatePresence>
			{active ? (
				<motion.div
					animate={{ opacity: 1 }}
					aria-hidden="true"
					className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-muted"
					exit={{ opacity: 0 }}
					initial={{ opacity: 0 }}
					transition={{ duration: 0.2 }}
				>
					<motion.div
						animate={{ x: ["-100%", "300%"] }}
						className="h-full w-2/5 bg-foreground"
						transition={{
							duration: 1.05,
							ease: "easeInOut",
							repeat: Number.POSITIVE_INFINITY,
						}}
					/>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
