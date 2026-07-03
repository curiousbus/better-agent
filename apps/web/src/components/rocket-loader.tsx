import { Rocket } from "lucide-react";
import type { CSSProperties } from "react";

// Space bodies drifting past toward the lower-left (opposite the flight
// direction). Small on purpose — motion cues, not scenery.
const SPACE_BODIES = [
	{ kind: "star", top: "12%", left: "26%", delay: "0s", duration: "2.2s" },
	{ kind: "star", top: "62%", left: "14%", delay: "0.9s", duration: "2.6s" },
	{ kind: "star", top: "34%", left: "70%", delay: "1.5s", duration: "2s" },
	{ kind: "star", top: "80%", left: "52%", delay: "0.4s", duration: "2.8s" },
	{ kind: "star", top: "48%", left: "40%", delay: "2s", duration: "2.4s" },
	{ kind: "star", top: "22%", left: "84%", delay: "1.2s", duration: "1.9s" },
	{ kind: "meteor", top: "24%", left: "58%", delay: "1.1s", duration: "1.8s" },
	{ kind: "meteor", top: "66%", left: "30%", delay: "2.6s", duration: "1.6s" },
	{ kind: "planet", top: "70%", left: "78%", delay: "0.2s", duration: "4.5s" },
	{ kind: "planet", top: "16%", left: "44%", delay: "1.8s", duration: "5.2s" },
	{ kind: "ringed", top: "44%", left: "8%", delay: "3s", duration: "6s" },
] as const;

// Exhaust dashes step down the flight axis behind the rocket.
const EXHAUST = [
	{ delay: "0s", offset: 0 },
	{ delay: "0.25s", offset: 6 },
	{ delay: "0.5s", offset: 12 },
] as const;

type SpaceBodySpec = (typeof SPACE_BODIES)[number];

function driftStyle(body: SpaceBodySpec, opacity?: string): CSSProperties {
	return {
		top: body.top,
		left: body.left,
		"--drift-delay": body.delay,
		"--drift-duration": body.duration,
		...(opacity ? { "--drift-opacity": opacity } : {}),
	} as CSSProperties;
}

const BODY_CLASS: Record<SpaceBodySpec["kind"], string> = {
	// Aligned with the travel axis (↗︎): -rotate-45, streaking tail behind.
	meteor:
		"space-drift absolute h-0.5 w-4 -rotate-45 rounded-full bg-gradient-to-r from-transparent to-primary/70",
	planet: "space-drift absolute size-2.5 rounded-full bg-muted-foreground/30",
	ringed:
		"space-drift absolute size-3 rounded-full border-2 border-muted-foreground/40 bg-muted-foreground/15",
	star: "space-drift absolute size-1 rounded-full bg-muted-foreground/60",
};

const BODY_OPACITY: Partial<Record<SpaceBodySpec["kind"], string>> = {
	meteor: "0.9",
	planet: "0.5",
	ringed: "0.45",
};

/**
 * Full-area loading state: a rocket cruising toward the upper-right while
 * stars, meteors and small planets streak past to the lower-left — the scene
 * reads as continuous forward flight. No caption; the motion IS the loading.
 */
export function RocketLoader({ label = "Loading" }: { label?: string }) {
	return (
		<div
			aria-label={label}
			className="flex h-full flex-1 items-center justify-center"
			role="status"
		>
			<div className="relative size-44 overflow-hidden">
				{SPACE_BODIES.map((body) => {
					const bodyClass = BODY_CLASS[body.kind];
					const bodyOpacity = BODY_OPACITY[body.kind];
					return (
						<span
							className={bodyClass}
							key={`${body.kind}-${body.top}-${body.left}`}
							style={driftStyle(body, bodyOpacity)}
						/>
					);
				})}
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="relative">
						{/* lucide's rocket artwork points up-right natively. */}
						<Rocket className="rocket-fly size-10 text-primary" />
						{EXHAUST.map((dash) => (
							<span
								className="rocket-exhaust absolute h-0.5 w-3 -rotate-45 rounded-full bg-primary/60"
								key={dash.delay}
								style={
									{
										bottom: `${dash.offset - 4}px`,
										left: `${-dash.offset}px`,
										"--drift-delay": dash.delay,
									} as CSSProperties
								}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
