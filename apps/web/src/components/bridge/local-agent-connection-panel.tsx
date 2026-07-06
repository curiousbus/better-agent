import { CopyAction } from "@better-agent/ui/components/actions";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { BridgeTokenRow } from "@/utils/api-types";
import { localAgentDisplayName } from "./local-agent-format";
import { bridgeCliCommand } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs";

function CopyableCode({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<code className={CODE_CLASS}>{value}</code>
			<CopyAction label={label} text={value} />
		</div>
	);
}

function PanelHeader({
	token,
	onDelete,
}: {
	token: BridgeTokenRow;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<div className="flex min-w-0 items-center gap-2">
				<AgentKindIcon
					className="size-4 shrink-0 text-muted-foreground"
					kind={token.agentKind}
				/>
				<span className="truncate font-medium text-sm">
					{localAgentDisplayName({
						latestSession: null,
						status: "not-connected",
						token,
					})}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{AGENT_KIND_LABEL[token.agentKind]}
				</span>
			</div>
			<DeleteConfirm
				label="Delete this local agent? Its token and all sessions are removed."
				onConfirm={onDelete}
			/>
		</div>
	);
}

function PanelBody({ token }: { token: BridgeTokenRow }) {
	if (!token.token) {
		return (
			<p className="text-muted-foreground text-xs">
				This agent was created before tokens were re-viewable. Recreate it to
				get a copyable token and command.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<div>
				<p className="mb-1 text-muted-foreground text-xs">Bridge token</p>
				<CopyableCode label="Copy token" value={token.token} />
			</div>
			<div>
				<p className="mb-1 text-muted-foreground text-xs">
					Run this from your project directory:
				</p>
				<CopyableCode
					label="Copy command"
					value={bridgeCliCommand(token.agentKind, token.token)}
				/>
			</div>
		</div>
	);
}

/** The always-present header of a bound local agent's page: its name + agent
 * kind, its permanently-viewable bridge token (copyable) and the ready-to-run
 * CLI command, plus the delete-the-agent action. Legacy hash-only tokens have
 * no raw value to show, so they get a recreate hint instead. */
export function LocalAgentConnectionPanel({
	token,
	onDelete,
	deleting,
}: {
	token: BridgeTokenRow;
	onDelete: () => void;
	deleting: boolean;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
			<PanelHeader onDelete={onDelete} token={token} />
			{deleting ? (
				<p className="text-muted-foreground text-xs">Deleting…</p>
			) : null}
			<PanelBody token={token} />
		</div>
	);
}
