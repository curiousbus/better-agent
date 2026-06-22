export type ChatDensity = "comfortable" | "compact";
export type ChatReasoningMode = "hidden" | "collapsed" | "expanded";
export type ChatToolDetail = "summary" | "raw";
export type ChatMessageAction = "copy" | "retry" | "edit" | "raw";

export interface ChatConfig {
	density: ChatDensity;
	messageActions: ChatMessageAction[];
	showMeta: boolean;
	showReasoning: ChatReasoningMode;
	showToolDetail: ChatToolDetail;
}

export interface DensityTokens {
	assistantProse: string;
	messagePadding: string;
	metaText: string;
	thread: string;
	turnGap: string;
}

const COMFORTABLE_TOKENS: DensityTokens = {
	thread: "mx-auto w-full max-w-3xl",
	turnGap: "gap-6",
	assistantProse: "text-[15px] leading-7",
	messagePadding: "px-4 py-3",
	metaText: "hidden",
};

const COMPACT_TOKENS: DensityTokens = {
	thread: "w-full max-w-none",
	turnGap: "gap-3",
	assistantProse: "text-sm leading-6",
	messagePadding: "px-3 py-2",
	metaText: "font-mono text-muted-foreground text-xs",
};

export function resolveDensityTokens(density: ChatDensity): DensityTokens {
	return density === "comfortable" ? COMFORTABLE_TOKENS : COMPACT_TOKENS;
}

export const COMFORTABLE_CONFIG: ChatConfig = {
	density: "comfortable",
	showReasoning: "collapsed",
	showMeta: false,
	showToolDetail: "summary",
	messageActions: ["copy", "retry", "edit"],
};

export const COMPACT_CONFIG: ChatConfig = {
	density: "compact",
	showReasoning: "expanded",
	showMeta: true,
	showToolDetail: "raw",
	messageActions: ["copy", "retry", "raw"],
};
