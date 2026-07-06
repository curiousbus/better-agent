import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { cn } from "@better-agent/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import {
	AGENT_KIND_LABEL,
	AGENT_KIND_OPTIONS,
	AgentKindIcon,
} from "./local-agent-kind-icon";

type AgentKind = BridgeTokenRow["agentKind"];

function useCreateBridgeToken(onCreated: (tokenId: string) => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.createToken.mutationOptions({
			onSuccess: (result) => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				onCreated(result.id);
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function AgentKindPicker({
	value,
	onChange,
}: {
	value: AgentKind | null;
	onChange: (kind: AgentKind) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label>Agent</Label>
			<div className="grid grid-cols-2 gap-2">
				{AGENT_KIND_OPTIONS.map((kind) => {
					const selected = kind === value;
					return (
						<button
							aria-pressed={selected}
							className={cn(
								"flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
								selected
									? "border-primary bg-primary/10 text-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground"
							)}
							key={kind}
							onClick={() => onChange(kind)}
							type="button"
						>
							<AgentKindIcon className="size-4 shrink-0" kind={kind} />
							{AGENT_KIND_LABEL[kind]}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function AddLocalAgentForm({
	name,
	onName,
	kind,
	onKind,
	onSubmit,
	pending,
}: {
	name: string;
	onName: (value: string) => void;
	kind: AgentKind | null;
	onKind: (value: AgentKind) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<AgentKindPicker onChange={onKind} value={kind} />
			<div className="flex flex-col gap-1">
				<Label htmlFor="local-agent-name">Name</Label>
				<Input
					id="local-agent-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="e.g. laptop"
					value={name}
				/>
			</div>
			<Button
				className="self-end"
				disabled={pending || kind === null}
				type="submit"
			>
				{pending ? "Creating…" : "Create"}
			</Button>
		</form>
	);
}

/**
 * "Add a local agent": pick which agent this token is for (bound to it for
 * life) and optionally name it, then create. The raw token lives on the new
 * agent's own page — we navigate there on success rather than revealing it
 * once here.
 */
export function AddLocalAgentDialog() {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<AgentKind | null>(null);

	const create = useCreateBridgeToken((tokenId) => {
		setOpen(false);
		navigate({ params: { tokenId }, to: "/local-agents/$tokenId" });
	});

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setName("");
			setKind(null);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add local agent
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add local agent</DialogTitle>
					<DialogDescription>
						Choose which agent this connection runs, then find its token and
						ready-to-run command on the agent's page.
					</DialogDescription>
				</DialogHeader>
				<AddLocalAgentForm
					kind={kind}
					name={name}
					onKind={setKind}
					onName={setName}
					onSubmit={() =>
						kind &&
						create.mutate({ agentKind: kind, name: name.trim() || undefined })
					}
					pending={create.isPending}
				/>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}
