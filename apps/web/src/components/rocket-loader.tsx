import { Rocket } from "lucide-react";
import type { CSSProperties } from "react";

// Space bodies drifting past toward the lower-left (opposite the flight
// direction). Small and sparse on purpose — motion cues, not scenery.
const SPACE_BODIES = [
	{ kind: "star", top: "18%", left: "30%", delay: "0s", duration: "2.2s" },
	{ kind: "star", top: "62%", left: "18%", delay: "0.9s", duration: "2.6s" },
	{ kind: "star", top: "38%", left: "72%", delay: "1.5s", duration: "2s" },
	{ kind: "star", top: "78%", left: "58%", delay: "0.4s", duration: "2.8s" },
	{ kind: "meteor", top: "26%", left: "55%", delay: "1.1s", duration: "1.8s" },
	{ kind: "planet", top: "70%", left: "76%", delay: "0.2s", duration: "4.5s" },
] as const;

const EXHAUST_DELAYS = ["0s", "0.25s", "0.5s"] as const;

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

function SpaceBody({ body }: { body: SpaceBodySpec }) {
	if (body.kind === "meteor") {
		return (
			<span
				className="space-drift absolute h-0.5 w-4 rotate-45 rounded-full bg-gradient-to-r from-primary/70 to-transparent"
				style={driftStyle(body, "0.9")}
			/>
		);
	}
	if (body.kind === "planet") {
		return (
			<span
				className="space-drift absolute size-3 rounded-full border border-muted-foreground/40 bg-muted-foreground/20"
				style={driftStyle(body, "0.5")}
			/>
		);
	}
	return (
		<span
			className="space-drift absolute size-1 rounded-full bg-muted-foreground/60"
			style={driftStyle(body)}
		/>
	);
}

/**
 * Full-area loading state: a rocket cruising toward the upper-right while
 * stars, a meteor and a small planet streak past to the lower-left — the
 * scene reads as continuous forward flight.
 */
export function RocketLoader({ label = "Launching…" }: { label?: string }) {
	return (
		<div
			aria-label={label}
			className="flex h-full flex-1 flex-col items-center justify-center gap-3"
			role="status"
		>
			<div className="relative size-40 overflow-hidden">
				{SPACE_BODIES.map((body) => (
					<SpaceBody
						body={body}
						key={`${body.kind}-${body.top}-${body.left}`}
					/>
				))}
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="relative">
						{/* lucide's rocket artwork points up-right natively. */}
						<Rocket className="rocket-fly size-10 text-primary" />
						<div className="absolute top-8 right-8">
							{EXHAUST_DELAYS.map((delay) => (
								<span
									className="rocket-exhaust absolute h-0.5 w-3 rotate-45 rounded-full bg-primary/60"
									key={delay}
									style={{ "--drift-delay": delay } as CSSProperties}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
			<p className="text-muted-foreground text-sm">{label}</p>
		</div>
	);
}
