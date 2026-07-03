import type { NodeProps } from "@better-agent/ui/components/genui/generative-ui";
import {
	BadgeCheck,
	BarChart3,
	Heart,
	type LucideIcon,
	MessageCircle,
	Repeat2,
	X as XLogo,
} from "lucide-react";

type UINode = NodeProps["node"];

const str = (v: unknown, fallback = ""): string =>
	typeof v === "string" ? v : fallback;

const num = (v: unknown): number | undefined =>
	typeof v === "number" ? v : undefined;

const KILO = 1000;
const MEGA = 1_000_000;
const DECIMAL_ROUND = 10;
const MAX_MEDIA = 4;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const RECENT_DAYS_WINDOW = 7;

const RELATIVE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
});

function trimDecimal(v: number): string {
	const rounded = Math.round(v * DECIMAL_ROUND) / DECIMAL_ROUND;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function compactNumber(n: number): string {
	if (n < KILO) {
		return String(n);
	}
	if (n < MEGA) {
		return `${trimDecimal(n / KILO)}K`;
	}
	return `${trimDecimal(n / MEGA)}M`;
}

function relativeTime(iso: string): string {
	if (!iso) {
		return "";
	}
	const date = new Date(iso);
	const elapsedMs = Date.now() - date.getTime();
	if (Number.isNaN(elapsedMs)) {
		return "";
	}
	const seconds = Math.floor(elapsedMs / MS_PER_SECOND);
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	const days = Math.floor(hours / HOURS_PER_DAY);
	if (minutes < 1) {
		return "now";
	}
	if (hours < 1) {
		return `${minutes}m`;
	}
	if (days < 1) {
		return `${hours}h`;
	}
	if (days < RECENT_DAYS_WINDOW) {
		return `${days}d`;
	}
	return RELATIVE_DATE_FORMAT.format(date);
}

function AuthorAvatar({ name, url }: { name: string; url: string }) {
	if (url) {
		return (
			// biome-ignore lint/correctness/useImageSize: remote avatar, size set via className
			<img
				alt=""
				className="size-10 shrink-0 rounded-full object-cover"
				src={url}
			/>
		);
	}
	const initial = name.charAt(0).toUpperCase() || "?";
	return (
		<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm">
			{initial}
		</div>
	);
}

function TweetCardHeader({ node }: { node: UINode }) {
	const authorName = str(node.props.authorName, "Someone");
	const authorHandle = str(node.props.authorHandle);
	const avatarUrl = str(node.props.authorAvatarUrl);
	const postedAt = str(node.props.postedAt);
	const verified = node.props.verified === true;
	const relative = postedAt ? relativeTime(postedAt) : "";
	return (
		<div className="flex items-start gap-3">
			<AuthorAvatar name={authorName} url={avatarUrl} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1">
					<span className="truncate font-medium text-sm">{authorName}</span>
					{verified ? (
						<BadgeCheck className="size-4 shrink-0 text-sky-500" />
					) : null}
				</div>
				<div className="truncate text-muted-foreground text-xs">
					@{authorHandle}
					{relative ? ` · ${relative}` : ""}
				</div>
			</div>
			<XLogo className="size-4 shrink-0 text-muted-foreground" />
		</div>
	);
}

function TweetCardMedia({ urls }: { urls: unknown[] }) {
	const images = urls
		.filter((u): u is string => typeof u === "string")
		.slice(0, MAX_MEDIA);
	if (images.length === 0) {
		return null;
	}
	const gridClassName =
		images.length > 1 ? "grid grid-cols-2 gap-1" : "grid grid-cols-1";
	return (
		<div className={gridClassName}>
			{images.map((src) => (
				// biome-ignore lint/correctness/useImageSize: remote tweet media, size set via className
				<img
					alt=""
					className="max-h-64 w-full rounded-lg object-cover"
					key={src}
					src={src}
				/>
			))}
		</div>
	);
}

function TweetCardBody({ node }: { node: UINode }) {
	const text = str(node.props.text);
	const mediaUrls = Array.isArray(node.props.mediaUrls)
		? node.props.mediaUrls
		: [];
	return (
		<div className="flex flex-col gap-2">
			<p className="whitespace-pre-wrap break-words text-sm">{text}</p>
			<TweetCardMedia urls={mediaUrls} />
		</div>
	);
}

function StatItem({
	icon: Icon,
	value,
}: {
	icon: LucideIcon;
	value: number | undefined;
}) {
	if (value === undefined) {
		return null;
	}
	return (
		<span className="flex items-center gap-1">
			<Icon className="size-3.5" />
			{compactNumber(value)}
		</span>
	);
}

function TweetCardStats({ node }: { node: UINode }) {
	const replyCount = num(node.props.replyCount);
	const retweetCount = num(node.props.retweetCount);
	const likeCount = num(node.props.likeCount);
	const viewCount = num(node.props.viewCount);
	return (
		<div className="flex items-center gap-4 text-muted-foreground text-xs">
			<StatItem icon={MessageCircle} value={replyCount} />
			<StatItem icon={Repeat2} value={retweetCount} />
			<StatItem icon={Heart} value={likeCount} />
			<StatItem icon={BarChart3} value={viewCount} />
		</div>
	);
}

export function TweetCardNode({ node }: NodeProps) {
	const url = str(node.props.url);
	const body = (
		<div className="flex w-full max-w-md flex-col gap-3 rounded-xl border bg-card p-4">
			<TweetCardHeader node={node} />
			<TweetCardBody node={node} />
			<TweetCardStats node={node} />
		</div>
	);
	if (!url) {
		return body;
	}
	return (
		<a
			className="block w-full max-w-md no-underline"
			href={url}
			rel="noopener noreferrer"
			target="_blank"
		>
			{body}
		</a>
	);
}
