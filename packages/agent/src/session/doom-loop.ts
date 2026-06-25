export const DOOM_LOOP_THRESHOLD = 3;

export const DOOM_LOOP_MESSAGE =
	"You have called this tool with identical arguments several times in a row. Stop repeating the same call; try a different approach or a different tool.";

export interface DoomLoopGuard {
	/** Records a call; returns true on the Nth consecutive identical (toolName,args) call. */
	check(toolName: string, args: unknown): boolean;
}

function signature(toolName: string, args: unknown): string {
	return `${toolName}:${JSON.stringify(args)}`;
}

export function createDoomLoopGuard(
	threshold: number = DOOM_LOOP_THRESHOLD
): DoomLoopGuard {
	let lastSig: string | null = null;
	let count = 0;
	return {
		check(toolName, args) {
			const sig = signature(toolName, args);
			if (sig === lastSig) {
				count += 1;
			} else {
				lastSig = sig;
				count = 1;
			}
			return count >= threshold;
		},
	};
}
