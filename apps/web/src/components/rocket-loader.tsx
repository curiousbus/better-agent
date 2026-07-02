import { Rocket } from "lucide-react";

const TRAILS = [
	{ delay: "0s", className: "left-1 h-4 bg-primary/40" },
	{ delay: "0.3s", className: "left-1/2 h-5 -translate-x-1/2 bg-primary/60" },
	{ delay: "0.55s", className: "right-1 h-3 bg-primary/30" },
] as const;

// Full-area loading state: an ascending rocket (bobbing hull + falling exhaust
// streaks). Used for app-level loads instead of bare skeleton blocks.
export function RocketLoader({ label = "Launching…" }: { label?: string }) {
	return (
		<div
			aria-label={label}
			className="flex h-full flex-1 flex-col items-center justify-center gap-3"
			role="status"
		>
			<div className="flex flex-col items-center">
				<Rocket className="rocket-float size-10 text-primary" />
				<div className="relative mt-1 h-10 w-8">
					{TRAILS.map((trail) => (
						<span
							className={`rocket-trail absolute top-0 w-0.5 rounded-full ${trail.className}`}
							key={trail.delay}
							style={{ animationDelay: trail.delay }}
						/>
					))}
				</div>
			</div>
			<p className="text-muted-foreground text-sm">{label}</p>
		</div>
	);
}
