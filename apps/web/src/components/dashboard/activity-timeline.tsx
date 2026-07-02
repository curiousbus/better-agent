// apps/web/src/components/dashboard/activity-timeline.tsx
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, BotIcon, LogInIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { relativeTime } from "@/board/relative-time";
import { orpc } from "@/utils/orpc";

type ActivityType = "login" | "agent_created" | "agent_deleted";

interface ActivityEvent {
	createdAt: Date;
	id: string;
	summary: string;
	type: string;
}

const ICON_MAP: Record<ActivityType, ReactNode> = {
	login: <LogInIcon className="size-4" />,
	agent_created: <BotIcon className="size-4" />,
	agent_deleted: <Trash2Icon className="size-4" />,
};

function isActivityType(type: string): type is ActivityType {
	return (
		type === "login" || type === "agent_created" || type === "agent_deleted"
	);
}

function TimelineIcon({ type }: { type: string }) {
	const icon = isActivityType(type) ? (
		ICON_MAP[type]
	) : (
		<ActivityIcon className="size-4" />
	);
	return (
		<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
			{icon}
		</div>
	);
}

function TimelineItem({ event }: { event: ActivityEvent }) {
	return (
		<div className="flex items-start gap-3">
			<TimelineIcon type={event.type} />
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="truncate text-sm">{event.summary}</span>
				<span className="text-muted-foreground text-xs">
					{relativeTime(event.createdAt.toISOString())}
				</span>
			</div>
		</div>
	);
}

const SKELETON_COUNT = 3;
const SKELETON_KEYS = Array.from(
	{ length: SKELETON_COUNT },
	(_, i) => `sk-${i}`
);

function TimelineSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			{SKELETON_KEYS.map((k) => (
				<div className="flex items-start gap-3" key={k}>
					<Skeleton className="size-8 shrink-0 rounded-full" />
					<div className="flex flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-3 w-1/4" />
					</div>
				</div>
			))}
		</div>
	);
}

function TimelineEmpty() {
	return <p className="text-muted-foreground text-sm">No activity yet.</p>;
}

function TimelineBody({
	isPending,
	events,
}: {
	isPending: boolean;
	events: ActivityEvent[];
}) {
	if (isPending) {
		return <TimelineSkeleton />;
	}
	if (events.length === 0) {
		return <TimelineEmpty />;
	}
	return (
		<div className="flex flex-col gap-4">
			{events.map((event) => (
				<TimelineItem event={event} key={event.id} />
			))}
		</div>
	);
}

export function ActivityTimeline() {
	const query = useQuery(orpc.activity.list.queryOptions());
	const events = query.data ?? [];

	return (
		<section className="flex flex-col gap-4">
			<h2 className="font-semibold text-base">Recent Activity</h2>
			<TimelineBody events={events} isPending={query.isPending} />
		</section>
	);
}
