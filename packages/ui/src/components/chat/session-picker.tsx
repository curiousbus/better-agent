import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

const SHORT_ID_LENGTH = 8;

interface SessionRow {
	id: string;
	title: string | null;
}

function sessionLabel(session: SessionRow): string {
	return session.title ?? `Session ${session.id.slice(0, SHORT_ID_LENGTH)}`;
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
	return (
		<Select
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
