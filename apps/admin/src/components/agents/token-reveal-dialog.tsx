import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

const COPIED_RESET_MS = 1500;

function CopyTokenButton({ token }: { token: string }) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		navigator.clipboard.writeText(token).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_RESET_MS);
			},
			() => {
				// clipboard blocked (non-secure context / no permission): no-op
			}
		);
	};
	return (
		<Button onClick={copy} size="sm" type="button" variant="outline">
			{copied ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CopyIcon className="size-3.5" />
			)}
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

/**
 * Shows a freshly-minted agent token once, in a modal the user must explicitly
 * dismiss, with a copy button. Driven by `token`: a non-null value opens it.
 */
export function TokenRevealDialog({
	token,
	onClose,
}: {
	token: string | null;
	onClose: () => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={token !== null}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Agent token</DialogTitle>
					<DialogDescription>
						Copy this token now — it is shown once and cannot be retrieved
						later. Store it somewhere safe; anyone with it can chat as this
						agent.
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2">
					<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
						{token}
					</code>
					{token ? <CopyTokenButton token={token} /> : null}
				</div>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}
