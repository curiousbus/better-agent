import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { type KeyboardEvent, useState } from "react";

import type { AgentForm } from "./agent-form";

type SetForm = (patch: Partial<AgentForm>) => void;

const SUGGESTED_TOOLKITS = [
	"hackernews",
	"github",
	"gmail",
	"slack",
	"googledocs",
] as const;

function ToolkitChip({
	slug,
	onRemove,
}: {
	slug: string;
	onRemove: () => void;
}) {
	return (
		<span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm">
			{slug}
			<button
				aria-label={`Remove ${slug}`}
				className="ml-1 text-muted-foreground leading-none hover:text-foreground"
				onClick={onRemove}
				type="button"
			>
				×
			</button>
		</span>
	);
}

function SuggestionRow({
	value,
	onChange,
}: {
	value: string[];
	onChange: (next: string[]) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1">
			<span className="self-center text-muted-foreground text-xs">
				Suggestions:
			</span>
			{SUGGESTED_TOOLKITS.map((slug) => (
				<Button
					disabled={value.includes(slug)}
					key={slug}
					onClick={() => onChange([...value, slug])}
					size="sm"
					type="button"
					variant="outline"
				>
					{slug}
				</Button>
			))}
		</div>
	);
}

function ToolkitsInput({
	value,
	onChange,
}: {
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const [draft, setDraft] = useState("");

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter") {
			return;
		}
		event.preventDefault();
		const slug = draft.trim().toLowerCase();
		if (slug !== "" && !value.includes(slug)) {
			onChange([...value, slug]);
		}
		setDraft("");
	};

	return (
		<div className="flex flex-col gap-2">
			<Input
				id="agent-toolkits"
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Type a toolkit slug and press Enter…"
				value={draft}
			/>
			{value.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{value.map((slug) => (
						<ToolkitChip
							key={slug}
							onRemove={() => onChange(value.filter((s) => s !== slug))}
							slug={slug}
						/>
					))}
				</div>
			)}
			<SuggestionRow onChange={onChange} value={value} />
		</div>
	);
}

export function ToolsStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<label
					className="font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
					htmlFor="agent-toolkits"
				>
					Composio toolkits
				</label>
				<ToolkitsInput
					onChange={(next) => set({ composioToolkits: next })}
					value={form.composioToolkits}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				Toolkit slugs from composio (e.g. hackernews). The agent can call any
				tool in these toolkits.
			</p>
		</div>
	);
}
