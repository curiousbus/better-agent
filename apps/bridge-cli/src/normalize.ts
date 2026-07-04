// Public entry point for the normalize layer: one pure mapping function per
// supported agent (`normalize.ts (NDJSON event → normalized)` in the task
// brief), plus the shared normalized-event types. The mapping logic itself
// lives in ./normalize/* so each agent's protocol quirks stay isolated and
// every file stays well under the line-count limit.
// biome-ignore lint/performance/noBarrelFile: intentional single entry point per the task brief's required module layout
export {
	buildClaudeInputFrame,
	normalizeClaudeCode,
} from "./normalize/claude-code";
export { normalizeCodex } from "./normalize/codex";
export { normalizeOpencode } from "./normalize/opencode";
export type {
	ErrorEvent,
	FileEvent,
	MessageEvent,
	NormalizedEvent,
	OutputEvent,
	StatusEvent,
	ToolEvent,
} from "./normalize/types";
