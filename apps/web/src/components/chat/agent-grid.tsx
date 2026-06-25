import type { AgentRow } from "@/utils/api-types";

function AgentCard({
	agent,
	onSelect,
}: {
	agent: AgentRow;
	onSelect: (agent: AgentRow) => void;
}) {
	return (
		<button
			className="flex w-full flex-col gap-1 rounded-lg p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={() => onSelect(agent)}
			type="button"
		>
			<span className="truncate font-medium text-sm">{agent.name}</span>
			<span className="truncate font-mono text-muted-foreground text-xs">
				{agent.providerId}/{agent.modelId}
			</span>
		</button>
	);
}

export function AgentGrid({
	agents,
	onSelect,
}: {
	agents: AgentRow[];
	onSelect: (agent: AgentRow) => void;
}) {
	if (agents.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
				No agents available.
			</div>
		);
	}
	return (
		<section
			aria-label="Agents"
			className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
		>
			{agents.map((agent) => (
				<AgentCard agent={agent} key={agent.id} onSelect={onSelect} />
			))}
		</section>
	);
}
