import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

type PresetId = "x-api" | "x-docs" | "custom";

interface Preset {
	id: PresetId;
	label: string;
	name: string;
	requiresToken: boolean;
	tokenHelp?: string;
	url: string;
}

const PRESETS: Preset[] = [
	{
		id: "x-api",
		label: "X (Twitter) API",
		name: "X API",
		url: "https://api.x.com/mcp",
		requiresToken: true,
		tokenHelp: "From your X Developer Portal app. Read endpoints only.",
	},
	{
		id: "x-docs",
		label: "X Docs",
		name: "X Docs",
		url: "https://docs.x.com/mcp",
		requiresToken: false,
	},
	{
		id: "custom",
		label: "Custom",
		name: "",
		url: "",
		requiresToken: false,
	},
];

function useCreateServer(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.mcp.createServer.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.mcp.listServers.key(),
				});
				toast.success("MCP server added");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function NameUrlFields({
	name,
	url,
	onNameChange,
	onUrlChange,
}: {
	name: string;
	url: string;
	onNameChange: (value: string) => void;
	onUrlChange: (value: string) => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-1">
				<Label htmlFor="mcp-name">Name</Label>
				<Input
					id="mcp-name"
					onChange={(event) => onNameChange(event.target.value)}
					placeholder="e.g. X API"
					required
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="mcp-url">URL</Label>
				<Input
					id="mcp-url"
					onChange={(event) => onUrlChange(event.target.value)}
					placeholder="https://example.com/mcp"
					required
					type="url"
					value={url}
				/>
			</div>
		</>
	);
}

function TokenField({
	preset,
	bearerToken,
	onChange,
}: {
	preset: Preset;
	bearerToken: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="mcp-token">
				{preset.requiresToken
					? "Bearer token (required)"
					: "Bearer token (optional)"}
			</Label>
			<Input
				autoComplete="off"
				id="mcp-token"
				onChange={(event) => onChange(event.target.value)}
				placeholder="Bearer token"
				required={preset.requiresToken}
				type="password"
				value={bearerToken}
			/>
			{preset.tokenHelp ? (
				<p className="text-muted-foreground text-xs">{preset.tokenHelp}</p>
			) : null}
		</div>
	);
}

function ServerForm({
	preset,
	onCreated,
}: {
	preset: Preset;
	onCreated: () => void;
}) {
	const [name, setName] = useState(preset.name);
	const [url, setUrl] = useState(preset.url);
	const [bearerToken, setBearerToken] = useState("");
	const create = useCreateServer(onCreated);

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate({
					name,
					url,
					bearerToken: bearerToken.trim() === "" ? undefined : bearerToken,
				});
			}}
		>
			<NameUrlFields
				name={name}
				onNameChange={setName}
				onUrlChange={setUrl}
				url={url}
			/>
			<TokenField
				bearerToken={bearerToken}
				onChange={setBearerToken}
				preset={preset}
			/>
			<Button className="self-end" disabled={create.isPending} type="submit">
				Add server
			</Button>
		</form>
	);
}

function PresetPicker({
	presetId,
	onChange,
	onCreated,
}: {
	presetId: PresetId;
	onChange: (id: PresetId) => void;
	onCreated: () => void;
}) {
	return (
		<Tabs
			onValueChange={(value) => onChange(value as PresetId)}
			value={presetId}
		>
			<TabsList className="w-full">
				{PRESETS.map((preset) => (
					<TabsTrigger key={preset.id} value={preset.id}>
						{preset.label}
					</TabsTrigger>
				))}
			</TabsList>
			{PRESETS.map((preset) => (
				<TabsContent key={preset.id} value={preset.id}>
					<ServerForm
						key={`${preset.id}-form`}
						onCreated={onCreated}
						preset={preset}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

export function AddMcpServerDialog() {
	const [open, setOpen] = useState(false);
	const [presetId, setPresetId] = useState<PresetId>("x-api");

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setPresetId("x-api");
				}
			}}
			open={open}
		>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add server
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add MCP server</DialogTitle>
				</DialogHeader>
				<PresetPicker
					onChange={(id) => setPresetId(id)}
					onCreated={() => setOpen(false)}
					presetId={presetId}
				/>
			</DialogContent>
		</Dialog>
	);
}
