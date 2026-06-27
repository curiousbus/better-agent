import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

interface SessionRow {
	id: string;
	title: string | null;
}

function sessionLabel(session: SessionRow): string {
	return session.title ?? "New chat";
}

export function SessionPicker({
	sessions,
	value,
	onChange,
}: {
	sessions: SessionRow[];
	value: string;
	onChange: (sessionId: string) => void;
}) {
	// Map value→label so the trigger shows the title, not the raw session id.
	const items = Object.fromEntries(
		sessions.map((s) => [s.id, sessionLabel(s)])
	);
	return (
		<Select
			items={items}
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger aria-label="Session" className="w-36 sm:w-64">
				<SelectValue placeholder="Select a session…" />
			</SelectTrigger>
			<SelectContent>
				{sessions.map((session) => (
					<SelectItem key={session.id} value={session.id}>
						{sessionLabel(session)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
