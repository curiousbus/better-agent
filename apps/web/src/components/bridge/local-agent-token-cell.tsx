import { CopyAction } from "@better-agent/ui/components/actions";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeTokenRow } from "@/utils/api-types";
import { bridgeCliCommand } from "./local-agent-join";

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs";

/** The token cell for the Local Agents table: a quiet `bt_…<last4>` chip that
 * opens a popover with the full raw token and the ready-to-run bridge command
 * (each copyable). This is where the token + command live now that the detail
 * page shows only the chat (Phase 4 follow-up). */
export function LocalAgentTokenCell({ token }: { token: BridgeTokenRow }) {
	const [open, setOpen] = useState(false);
	const raw = token.token;
	if (!raw) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<button
						className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
						title="Show token & run command"
						type="button"
					/>
				}
			>
				<KeyRoundIcon className="size-3" />…{token.last4 ?? raw.slice(-4)}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<div className="flex flex-col gap-2">
					<div>
						<p className="mb-1 text-muted-foreground text-xs">Bridge token</p>
						<div className="flex items-center gap-1.5">
							<code className={CODE_CLASS}>{raw}</code>
							<CopyAction label="Copy token" text={raw} />
						</div>
					</div>
					<div>
						<p className="mb-1 text-muted-foreground text-xs">Run command</p>
						<div className="flex items-center gap-1.5">
							<code className={CODE_CLASS}>
								{bridgeCliCommand(token.agentKind, raw)}
							</code>
							<CopyAction
								label="Copy command"
								text={bridgeCliCommand(token.agentKind, raw)}
							/>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
