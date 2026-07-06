import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { SparklesIcon } from "lucide-react";

function NameList({ names, title }: { names: string[]; title: string }) {
	if (names.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			<p className="font-medium text-muted-foreground text-xs">{title}</p>
			<div className="flex flex-wrap gap-1">
				{names.map((name) => (
					<code
						className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
						key={name}
					>
						{name}
					</code>
				))}
			</div>
		</div>
	);
}

export interface SkillsCommandsPopoverProps {
	disabled: boolean;
	/** The session's reported skill names (`session_ready.skills`), or undefined
	 * for agents that don't surface skills. */
	skills?: string[];
	/** The session's reported slash-command names (`session_ready.slashCommands`). */
	slashCommands?: string[];
}

/**
 * The header's "Skills & commands" button: lists the actual skill and slash-
 * command names the running agent reported, so they're discoverable without
 * having to type "/" in the composer. Renders nothing when the agent surfaced
 * neither (keeps the header clean for agents that don't report them).
 */
export function SkillsCommandsPopover({
	disabled,
	skills,
	slashCommands,
}: SkillsCommandsPopoverProps) {
	const skillNames = skills ?? [];
	const commandNames = slashCommands ?? [];
	if (skillNames.length + commandNames.length === 0) {
		return null;
	}
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label="Skills and commands"
						disabled={disabled}
						size="xs"
						variant="outline"
					/>
				}
			>
				<SparklesIcon />
				Skills & commands
			</PopoverTrigger>
			<PopoverContent className="w-80">
				<PopoverHeader>
					<PopoverTitle>Skills & commands</PopoverTitle>
				</PopoverHeader>
				<div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
					<NameList
						names={commandNames}
						title={`Slash commands (${commandNames.length})`}
					/>
					<NameList
						names={skillNames}
						title={`Skills (${skillNames.length})`}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
