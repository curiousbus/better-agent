import { Button } from "@better-agent/ui/components/button";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import type {
	SessionListDetail,
	SessionReadyDetail,
} from "./bridge-session-status";
import { AgentKindIcon } from "./local-agent-kind-icon";
import { PastConversations } from "./past-conversations";
import { SessionStatusHeader } from "./session-status-header";
import { SkillsCommandsPopover } from "./skills-commands-popover";
import type { TerminalConnectionStatus } from "./terminal-status";
import { TerminalStatus } from "./terminal-status";

/** Short enough to identify a session at a glance without dominating the row
 * — matches how git short-SHAs are conventionally truncated. */
const SESSION_ID_SHORT_LENGTH = 8;

function shortSessionId(id: string): string {
	return id.length > SESSION_ID_SHORT_LENGTH
		? `${id.slice(0, SESSION_ID_SHORT_LENGTH)}…`
		: id;
}

/** `Session: 11c186d9…` — the ONE prominent identifier for the session, the
 * agent/claude session id when the CLI has reported one, else the bridge
 * session id. Full id in the tooltip. Deliberately not the session `label`,
 * which is routinely "untitled". */
function SessionIdLabel({
	agentKind,
	sessionId,
}: {
	agentKind: BridgeSessionRow["agentKind"];
	sessionId: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			<span className="truncate font-medium text-sm" title={sessionId}>
				Session: {shortSessionId(sessionId)}
			</span>
		</span>
	);
}

interface TerminalHeaderActionsProps {
	canSend: boolean;
	caps: AgentCapabilities;
	ending: boolean;
	listSessions: () => void;
	onEnd?: () => void;
	sessionList: SessionListDetail | null;
	sessionReady: SessionReadyDetail | null;
	status: TerminalConnectionStatus;
}

/** The header's right-hand action cluster: past conversations, skills &
 * commands, and the End button — each gated on `caps` (End also hidden once the
 * session has ended, or when no `onEnd` is wired, e.g. in tests). The model /
 * permission-mode / interrupt controls now live in the composer's bottom bar
 * (see terminal-composer.tsx), not here. Split out purely to keep
 * `TerminalHeader` under the repo's max-lines-per-function gate. */
function TerminalHeaderActions({
	canSend,
	caps,
	ending,
	listSessions,
	onEnd,
	sessionList,
	sessionReady,
	status,
}: TerminalHeaderActionsProps) {
	const showEnd = status !== "ended" && onEnd !== undefined;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{caps.sessionList && (
				<PastConversations
					disabled={!canSend}
					onRequestList={listSessions}
					sessionList={sessionList}
				/>
			)}
			<SkillsCommandsPopover
				disabled={!canSend}
				skills={caps.skills ? sessionReady?.skills : undefined}
				slashCommands={
					caps.slashCommands ? sessionReady?.slashCommands : undefined
				}
			/>
			{showEnd && (
				<Button disabled={ending} onClick={onEnd} size="xs" variant="outline">
					End session
				</Button>
			)}
		</div>
	);
}

export interface TerminalHeaderProps extends TerminalHeaderActionsProps {
	agentKind: BridgeSessionRow["agentKind"];
	sessionId: string;
}

/** The single header for a Local Agent session: the prominent session id, the
 * ONE connection-status indicator, the capability summary, and the session
 * actions — each gated on `caps` (see agent-capabilities.ts) so a session only
 * shows what its running agent supports. Borderless; the whole detail view is
 * one cohesive surface, not a header stacked on a bordered terminal. */
export function TerminalHeader({
	agentKind,
	sessionId,
	sessionReady,
	status,
	...actions
}: TerminalHeaderProps) {
	return (
		<div className="flex shrink-0 flex-col gap-2 bg-muted/40 px-3 py-2.5 sm:px-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2.5">
					<SessionIdLabel agentKind={agentKind} sessionId={sessionId} />
					<TerminalStatus status={status} />
				</div>
				<TerminalHeaderActions
					{...actions}
					sessionReady={sessionReady}
					status={status}
				/>
			</div>
			<SessionStatusHeader detail={sessionReady} />
		</div>
	);
}
