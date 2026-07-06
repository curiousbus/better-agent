import { BotIcon, Code2Icon, SparklesIcon, TerminalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";

type AgentKind = BridgeSessionRow["agentKind"];

/** One distinct glyph per CLI kind so a session's kind is recognizable at a
 * glance on the list cards and the detail header, not just from the text
 * label next to it. */
export const AGENT_KIND_ICON: Record<AgentKind, typeof BotIcon> = {
	"claude-code": BotIcon,
	codex: Code2Icon,
	opencode: TerminalIcon,
	pi: SparklesIcon,
};

/** Human-facing name per CLI kind, for the create selector and detail header. */
export const AGENT_KIND_LABEL: Record<AgentKind, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	opencode: "opencode",
	pi: "Pi",
};

/** The pickable agent kinds, in the order they're offered at creation. */
export const AGENT_KIND_OPTIONS: readonly AgentKind[] = [
	"claude-code",
	"opencode",
	"codex",
	"pi",
];

/** Renders the icon for a bridge session's `agentKind`. Shared by
 * `LocalAgentCard` and the detail page header. */
export function AgentKindIcon({
	kind,
	...props
}: { kind: AgentKind } & ComponentProps<typeof BotIcon>) {
	const Icon = AGENT_KIND_ICON[kind];
	return <Icon aria-hidden {...props} />;
}
