import { expect, it } from "vitest";
import { AGENT_KIND_ICON } from "./local-agent-kind-icon";

const KNOWN_AGENT_KINDS = ["claude-code", "opencode", "codex"] as const;

it("maps every known agent kind to an icon component", () => {
	for (const kind of KNOWN_AGENT_KINDS) {
		expect(AGENT_KIND_ICON[kind]).toBeDefined();
	}
});

it("gives each agent kind a visually distinct icon", () => {
	const icons = KNOWN_AGENT_KINDS.map((kind) => AGENT_KIND_ICON[kind]);
	expect(new Set(icons).size).toBe(KNOWN_AGENT_KINDS.length);
});
