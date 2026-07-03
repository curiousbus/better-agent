import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

interface SessionRow {
	createdAt: string | Date;
	id: string;
	title: string | null;
}

// Cascading picker: level 1 = days (newest first), level 2 = that day's
// sessions by title. Submenu hover uses base-ui's built-in safe-polygon
// intent (the "safe triangle"), so diagonal cursor travel toward an open
// submenu never closes it. Shows the newest DAYS_PER_PAGE days; "More" pages
// in older days without closing the menu.
const DAYS_PER_PAGE = 5;

interface DayGroup {
	key: string;
	label: string;
	sessions: SessionRow[];
}

function sessionLabel(session: SessionRow): string {
	return session.title ?? "New chat";
}

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date: Date, now: Date): string {
	if (dayKey(date) === dayKey(now)) {
		return "Today";
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (dayKey(date) === dayKey(yesterday)) {
		return "Yesterday";
	}
	const sameYear = date.getFullYear() === now.getFullYear();
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
}

function groupByDay(sessions: SessionRow[]): DayGroup[] {
	const now = new Date();
	const sorted = [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
	const groups: DayGroup[] = [];
	const byKey = new Map<string, DayGroup>();
	for (const session of sorted) {
		const date = new Date(session.createdAt);
		const key = dayKey(date);
		let group = byKey.get(key);
		if (!group) {
			group = { key, label: dayLabel(date, now), sessions: [] };
			byKey.set(key, group);
			groups.push(group);
		}
		group.sessions.push(session);
	}
	return groups;
}

function DaySubmenu({
	group,
	value,
	onChange,
}: {
	group: DayGroup;
	value: string;
	onChange: (sessionId: string) => void;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<span className="flex-1">{group.label}</span>
				<span className="text-muted-foreground text-xs">
					{group.sessions.length}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
				{group.sessions.map((session) => (
					<DropdownMenuItem
						key={session.id}
						onClick={() => onChange(session.id)}
					>
						<span className="flex-1 truncate">{sessionLabel(session)}</span>
						{session.id === value ? <CheckIcon className="size-3.5" /> : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function PickerTrigger({ label }: { label: string }) {
	return (
		<DropdownMenuTrigger
			render={
				<Button
					aria-label="Session"
					className="w-28 justify-between sm:w-44 md:w-64"
					size="sm"
					variant="outline"
				/>
			}
		>
			<span className="truncate">{label}</span>
			<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
		</DropdownMenuTrigger>
	);
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
	const [pages, setPages] = useState(1);
	const groups = groupByDay(sessions);
	const visible = groups.slice(0, pages * DAYS_PER_PAGE);
	const hasMore = groups.length > visible.length;
	const current = sessions.find((s) => s.id === value);

	return (
		<DropdownMenu onOpenChange={(open) => open && setPages(1)}>
			<PickerTrigger
				label={current ? sessionLabel(current) : "Select a session…"}
			/>
			<DropdownMenuContent align="end" className="w-48">
				{visible.map((group) => (
					<DaySubmenu
						group={group}
						key={group.key}
						onChange={onChange}
						value={value}
					/>
				))}
				{hasMore ? (
					<DropdownMenuItem
						closeOnClick={false}
						onClick={() => setPages((p) => p + 1)}
					>
						<span className="flex-1 text-muted-foreground">More…</span>
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
