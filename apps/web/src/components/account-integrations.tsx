import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client, orpc } from "@/utils/orpc";

interface Toolkit {
	description: string;
	name: string;
	needsAuth: boolean;
	slug: string;
}

interface Connection {
	active: boolean;
	id: string;
	status: string;
	toolkitSlug: string;
}

interface IntegrationActionsProps {
	connection: Connection | undefined;
	slug: string;
}

function IntegrationActions({ connection, slug }: IntegrationActionsProps) {
	const queryClient = useQueryClient();
	const isConnected = connection?.active === true;

	const disconnectMutation = useMutation({
		...orpc.composio.disconnect.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.composio.connections.key(),
			});
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const handleConnect = async () => {
		try {
			const { redirectUrl } = await client.composio.connect({ toolkit: slug });
			if (redirectUrl) {
				window.location.href = redirectUrl;
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Connection failed");
		}
	};

	return (
		<div className="flex shrink-0 items-center gap-2">
			<Badge variant={isConnected ? "default" : "outline"}>
				{isConnected ? "Connected" : "Not connected"}
			</Badge>
			{isConnected ? (
				<Button
					disabled={disconnectMutation.isPending}
					onClick={() =>
						connection && disconnectMutation.mutate({ id: connection.id })
					}
					size="sm"
					variant="ghost"
				>
					Disconnect
				</Button>
			) : (
				<Button onClick={handleConnect} size="sm" variant="outline">
					Connect
				</Button>
			)}
		</div>
	);
}

interface IntegrationRowProps {
	connection: Connection | undefined;
	toolkit: Toolkit;
}

function IntegrationRow({ toolkit, connection }: IntegrationRowProps) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm">{toolkit.name}</span>
					<span className="font-mono text-muted-foreground text-xs">
						{toolkit.slug}
					</span>
				</div>
				{toolkit.description ? (
					<div className="truncate text-muted-foreground text-xs">
						{toolkit.description}
					</div>
				) : null}
			</div>
			<IntegrationActions connection={connection} slug={toolkit.slug} />
		</div>
	);
}

export function IntegrationsSection() {
	const toolkits = useQuery(orpc.composio.connectableToolkits.queryOptions());
	const connections = useQuery(orpc.composio.connections.queryOptions());

	if (!toolkits.data?.configured) {
		return null;
	}

	const toolkitList = toolkits.data.toolkits;

	if (toolkitList.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="text-muted-foreground text-sm">Integrations</div>
			{toolkitList.map((toolkit) => {
				const connection = connections.data?.find(
					(c) => c.toolkitSlug === toolkit.slug && c.active
				);
				return (
					<IntegrationRow
						connection={connection}
						key={toolkit.slug}
						toolkit={toolkit}
					/>
				);
			})}
		</div>
	);
}
