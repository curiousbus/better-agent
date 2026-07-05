import { expect, it } from "vitest";
import { CAPABILITIES, capabilities } from "./agent-capabilities";

// Phase 0.5: one canonical matrix (from the pi/opencode research in the plan
// doc) every optional Local Agent surface gates on. These assertions pin the
// matrix itself; terminal.test.tsx / terminal-controls.test.tsx cover the UI
// actually gating on it.

it("gives claude the full matrix — every optional surface on, the full permission-mode set", () => {
	const claude = capabilities("claude-code");
	expect(claude.reasoning).toBe(true);
	expect(claude.sessionList).toBe(true);
	expect(claude.sessionResume).toBe(true);
	expect(claude.slashCommands).toBe(true);
	expect(claude.skills).toBe(true);
	expect(claude.contextUsage).toBe(true);
	expect(claude.toolApproval).toBe(true);
	expect(claude.modelSwitch).toBe(true);
	expect(claude.interrupt).toBe(true);
	expect(claude.usageMode).toBe("stream");
	expect(claude.permissionModes).toEqual([
		"default",
		"acceptEdits",
		"bypassPermissions",
		"plan",
		"dontAsk",
		"auto",
	]);
});

it("gives pi no session-list or tool-approval, a poll usage mode, and a default/plan-only permission set", () => {
	const pi = capabilities("pi");
	expect(pi.sessionList).toBe(false);
	expect(pi.toolApproval).toBe(false);
	expect(pi.usageMode).toBe("poll");
	expect(pi.permissionModes).toEqual(["default", "plan"]);
	// Still supports these, per the research matrix.
	expect(pi.sessionResume).toBe(true);
	expect(pi.slashCommands).toBe(true);
	expect(pi.skills).toBe(true);
	expect(pi.modelSwitch).toBe(true);
	expect(pi.interrupt).toBe(true);
});

it("gives opencode session-list and tool-approval, a stream usage mode, and a default/plan-only permission set", () => {
	const opencode = capabilities("opencode");
	expect(opencode.sessionList).toBe(true);
	expect(opencode.toolApproval).toBe(true);
	expect(opencode.usageMode).toBe("stream");
	expect(opencode.permissionModes).toEqual(["default", "plan"]);
});

it("keeps codex conservative — everything off except reasoning and interrupt", () => {
	const codex = capabilities("codex");
	expect(codex.reasoning).toBe(true);
	expect(codex.interrupt).toBe(true);
	expect(codex.sessionList).toBe(false);
	expect(codex.sessionResume).toBe(false);
	expect(codex.slashCommands).toBe(false);
	expect(codex.skills).toBe(false);
	expect(codex.contextUsage).toBe(false);
	expect(codex.toolApproval).toBe(false);
	expect(codex.modelSwitch).toBe(false);
	expect(codex.usageMode).toBe("none");
	expect(codex.permissionModes).toEqual([]);
});

it("defines every known agent kind", () => {
	const knownKinds = ["claude-code", "opencode", "codex", "pi"] as const;
	for (const kind of knownKinds) {
		expect(CAPABILITIES[kind]).toBeDefined();
	}
});
