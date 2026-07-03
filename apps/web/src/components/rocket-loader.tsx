import { Rocket } from "lucide-react";
import type { CSSProperties } from "react";

// Two-layer parallax field drifting past the rocket toward the lower-left:
// FAR (`space-drift-far`, dim/small/slow, rendered behind the rocket) and
// NEAR (`space-drift-near`, bright/large/fast, rendered on top of it).

type Palette = "cool" | "warm";
interface DriftFields {
	readonly delay: string;
	readonly duration: string;
	readonly left: string;
	readonly top: string;
}
type PlanetVariant = DriftFields & {
	readonly kind: "planet";
	readonly palette: Palette;
	readonly sizeClass: string;
	readonly ringed?: boolean;
	readonly blurred?: boolean;
};
type FarBody =
	| (DriftFields & { readonly kind: "dust" | "star" })
	| PlanetVariant;
type NearBody =
	| (DriftFields & { readonly kind: "meteor" | "star" })
	| PlanetVariant;

const FAR_BODIES: readonly FarBody[] = [
	{ kind: "star", top: "10%", left: "20%", delay: "0s", duration: "5.2s" },
	{ kind: "star", top: "64%", left: "12%", delay: "1.4s", duration: "6s" },
	{ kind: "star", top: "30%", left: "78%", delay: "2.6s", duration: "5.6s" },
	{ kind: "star", top: "84%", left: "46%", delay: "0.8s", duration: "6.4s" },
	{ kind: "star", top: "46%", left: "34%", delay: "3.4s", duration: "5.4s" },
	{ kind: "star", top: "16%", left: "90%", delay: "2s", duration: "5.8s" },
	{ kind: "dust", top: "6%", left: "58%", delay: "1.1s", duration: "6.6s" },
	{ kind: "dust", top: "92%", left: "26%", delay: "2.9s", duration: "6.2s" },
	{ kind: "dust", top: "74%", left: "66%", delay: "4.1s", duration: "5.9s" },
	{ kind: "dust", top: "40%", left: "8%", delay: "0.4s", duration: "6.8s" },
	{
		kind: "planet",
		top: "20%",
		left: "6%",
		delay: "1.6s",
		duration: "9s",
		palette: "cool",
		sizeClass: "size-2",
	},
	{
		kind: "planet",
		top: "66%",
		left: "84%",
		delay: "3.6s",
		duration: "8.4s",
		palette: "warm",
		sizeClass: "size-2",
	},
] as const;

const NEAR_BODIES: readonly NearBody[] = [
	{ kind: "star", top: "12%", left: "46%", delay: "0.2s", duration: "2s" },
	{ kind: "star", top: "70%", left: "18%", delay: "1s", duration: "2.4s" },
	{ kind: "star", top: "36%", left: "88%", delay: "1.8s", duration: "1.8s" },
	{ kind: "star", top: "88%", left: "58%", delay: "0.6s", duration: "2.6s" },
	{ kind: "star", top: "52%", left: "30%", delay: "2.4s", duration: "2.1s" },
	{ kind: "meteor", top: "24%", left: "66%", delay: "0.5s", duration: "1.6s" },
	{ kind: "meteor", top: "78%", left: "36%", delay: "1.3s", duration: "1.5s" },
	{ kind: "meteor", top: "14%", left: "20%", delay: "2.2s", duration: "1.7s" },
	{
		kind: "planet",
		top: "68%",
		left: "80%",
		delay: "0.3s",
		duration: "3.6s",
		palette: "warm",
		sizeClass: "size-4",
		blurred: true,
	},
	{
		kind: "planet",
		top: "18%",
		left: "12%",
		delay: "1.6s",
		duration: "4.2s",
		palette: "cool",
		sizeClass: "size-5",
		ringed: true,
	},
	{
		kind: "planet",
		top: "48%",
		left: "58%",
		delay: "2.8s",
		duration: "3.8s",
		palette: "warm",
		sizeClass: "size-4",
	},
] as const;

// Exhaust dashes step down the flight axis behind the rocket.
const EXHAUST = [
	{ delay: "0s", offset: 0 },
	{ delay: "0.25s", offset: 6 },
	{ delay: "0.5s", offset: 12 },
] as const;
const EXHAUST_OFFSET_LIFT = 4;
const FAR_STAR_OPACITY = "0.35";
const FAR_DUST_OPACITY = "0.15";
const FAR_PLANET_OPACITY = "0.3";
const NEAR_STAR_OPACITY = "0.85";
const NEAR_PLANET_OPACITY = "0.8";
const FAR_BODY_CLASS: Record<"dust" | "star", string> = {
	dust: "space-drift-far absolute size-1 rounded-full bg-muted-foreground/30",
	star: "space-drift-far absolute size-1 rounded-full bg-muted-foreground/50",
};
const NEAR_BODY_CLASS: Record<"meteor" | "star", string> = {
	meteor:
		"space-drift-near absolute h-0.5 w-5 -rotate-45 rounded-full bg-gradient-to-r from-transparent to-primary/80",
	star: "space-drift-near absolute size-1.5 rounded-full bg-muted-foreground/80",
};
// Warm/cool planet shading driven by the existing chart theme tokens, so the
// palette stays muted and adapts automatically to dark mode.
const PLANET_PALETTE: Record<Palette, string> = {
	cool: "var(--chart-3)",
	warm: "var(--chart-1)",
};
const RING_ROTATION_DEG = 20;
const RING_SCALE_Y = 0.42;
const RING_OPACITY = 0.5;
const RING_INSET = "-38%";

function planetGradient(paletteColor: string): string {
	return [
		"radial-gradient(circle at 32% 28%, oklch(1 0 0 / 0.55) 0%, oklch(1 0 0 / 0) 38%)",
		"radial-gradient(circle at 70% 76%, oklch(0 0 0 / 0.42) 0%, oklch(0 0 0 / 0) 58%)",
		paletteColor,
	].join(", ");
}

function driftStyle(body: DriftFields, opacity: string): CSSProperties {
	return {
		top: body.top,
		left: body.left,
		"--drift-delay": body.delay,
		"--drift-duration": body.duration,
		"--drift-opacity": opacity,
	} as CSSProperties;
}
type PlanetProps = DriftFields & {
	readonly driftClass: "space-drift-far" | "space-drift-near";
	readonly opacity: string;
	readonly palette: Palette;
	readonly sizeClass: string;
	readonly ringed?: boolean;
	readonly blurred?: boolean;
};
/** A shaded planet: highlight + terminator gradient, optional tilted ring. */
function Planet({
	driftClass,
	opacity,
	palette,
	sizeClass,
	ringed,
	blurred,
	...drift
}: PlanetProps) {
	const paletteColor = PLANET_PALETTE[palette];
	const planetClass = `${driftClass} absolute ${sizeClass} rounded-full`;
	const style: CSSProperties = {
		...driftStyle(drift, opacity),
		backgroundImage: planetGradient(paletteColor),
		filter: blurred ? "blur(0.5px)" : undefined,
	};

	return (
		<span className={planetClass} style={style}>
			{ringed ? (
				<span
					className="pointer-events-none absolute rounded-full border"
					style={{
						borderColor: paletteColor,
						inset: RING_INSET,
						opacity: RING_OPACITY,
						transform: `rotate(${RING_ROTATION_DEG}deg) scaleY(${RING_SCALE_Y})`,
					}}
				/>
			) : null}
		</span>
	);
}

/** FAR layer: dim, small, slow-drifting stars, dust and 1-2 small planets. */
function FarField() {
	return (
		<>
			{FAR_BODIES.map((body) => {
				const key = `far-${body.kind}-${body.top}-${body.left}`;
				if (body.kind === "planet") {
					return (
						<Planet
							{...body}
							driftClass="space-drift-far"
							key={key}
							opacity={FAR_PLANET_OPACITY}
						/>
					);
				}
				const bodyClass = FAR_BODY_CLASS[body.kind];
				const bodyOpacity =
					body.kind === "star" ? FAR_STAR_OPACITY : FAR_DUST_OPACITY;
				return (
					<span
						className={bodyClass}
						key={key}
						style={driftStyle(body, bodyOpacity)}
					/>
				);
			})}
		</>
	);
}

/** NEAR layer: bright, larger, fast-drifting foreground bodies and planets. */
function NearField() {
	return (
		<>
			{NEAR_BODIES.map((body) => {
				const key = `near-${body.kind}-${body.top}-${body.left}`;
				if (body.kind === "planet") {
					return (
						<Planet
							{...body}
							driftClass="space-drift-near"
							key={key}
							opacity={NEAR_PLANET_OPACITY}
						/>
					);
				}
				const bodyClass = NEAR_BODY_CLASS[body.kind];
				return (
					<span
						className={bodyClass}
						key={key}
						style={driftStyle(body, NEAR_STAR_OPACITY)}
					/>
				);
			})}
		</>
	);
}

/** The rocket sprite plus its trailing exhaust dashes. */
function RocketSprite() {
	return (
		<div className="relative">
			{/* lucide's rocket artwork points up-right natively. */}
			<Rocket className="rocket-fly size-12 text-primary" />
			{EXHAUST.map((dash) => (
				<span
					className="rocket-exhaust absolute h-0.5 w-3 -rotate-45 rounded-full bg-primary/60"
					key={dash.delay}
					style={
						{
							bottom: `${dash.offset - EXHAUST_OFFSET_LIFT}px`,
							left: `${-dash.offset}px`,
							"--drift-delay": dash.delay,
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

/**
 * Full-area loading state: a rocket cruising toward the upper-right through a
 * two-layer parallax field — dim, slow far bodies behind it and bright, fast
 * near bodies in front — the scene reads as continuous forward flight with
 * depth. No caption; the motion IS the loading.
 */
export function RocketLoader({ label = "Loading" }: { label?: string }) {
	return (
		<div
			aria-label={label}
			className="flex h-full flex-1 items-center justify-center"
			role="status"
		>
			<div className="relative size-64 overflow-hidden">
				<FarField />
				<div className="absolute inset-0 flex items-center justify-center">
					<RocketSprite />
				</div>
				<NearField />
			</div>
		</div>
	);
}
