import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

function invalidateComposioKeys(
	queryClient: ReturnType<typeof useQueryClient>
) {
	queryClient.invalidateQueries({ queryKey: orpc.composio.keyStatus.key() });
	queryClient.invalidateQueries({
		queryKey: orpc.composio.connectableToolkits.key(),
	});
	queryClient.invalidateQueries({
		queryKey: orpc.composio.connections.key(),
	});
}

function useSetKey(onSuccess: () => void) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.composio.setKey.mutationOptions(),
		onSuccess: () => {
			invalidateComposioKeys(queryClient);
			onSuccess();
			toast.success("Saved");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

function useClearKey(onSuccess: () => void) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.composio.clearKey.mutationOptions(),
		onSuccess: () => {
			invalidateComposioKeys(queryClient);
			onSuccess();
			toast.success("Cleared");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

interface SaveKeyFormProps {
	configured: boolean;
}

function SaveKeyForm({ configured }: SaveKeyFormProps) {
	const [apiKey, setApiKey] = useState("");
	const saveKey = useSetKey(() => setApiKey(""));
	const clearKey = useClearKey(() => setApiKey(""));

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<Input
					aria-label="Composio API key"
					onChange={(e) => setApiKey(e.target.value)}
					placeholder="Composio API key"
					type="password"
					value={apiKey}
				/>
				<Button
					disabled={apiKey.length === 0 || saveKey.isPending}
					onClick={() => saveKey.mutate({ apiKey })}
					size="sm"
				>
					Save
				</Button>
				{configured ? (
					<Button
						disabled={clearKey.isPending}
						onClick={() => clearKey.mutate({})}
						size="sm"
						variant="ghost"
					>
						Clear
					</Button>
				) : null}
			</div>
		</div>
	);
}

export function ComposioKeySection() {
	const keyStatus = useQuery(orpc.composio.keyStatus.queryOptions());
	const configured = keyStatus.data?.configured ?? false;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground text-sm">Composio</span>
				<Badge variant={configured ? "default" : "outline"}>
					{configured ? "Connected" : "Not set"}
				</Badge>
			</div>
			<div className="text-muted-foreground text-xs">
				用你自己的 composio API key 连接工具,只对你生效。
			</div>
			<SaveKeyForm configured={configured} />
		</div>
	);
}
