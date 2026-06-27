import { describe, expect, it } from "vitest";
import { createAgentClientFrom, createUserSessionClientFrom } from "./internal";

describe("cancel()", () => {
	it("cancel() calls userSessions.cancel for the user-session client", async () => {
		const calls: Array<{ sessionId: string }> = [];
		const fake = {
			userSessions: {
				cancel: (input: { sessionId: string }) => {
					calls.push(input);
					return Promise.resolve({ ok: true });
				},
			},
		} as unknown as Parameters<typeof createUserSessionClientFrom>[0];
		const sdk = createUserSessionClientFrom(fake, "agent-1");
		await sdk.cancel("sess-1");
		expect(calls).toEqual([{ sessionId: "sess-1" }]);
	});

	it("cancel() calls sessions.cancel for the agent-token client", async () => {
		const calls: Array<{ sessionId: string }> = [];
		const fake = {
			sessions: {
				cancel: (input: { sessionId: string }) => {
					calls.push(input);
					return Promise.resolve({ ok: true });
				},
			},
		} as unknown as Parameters<typeof createAgentClientFrom>[0];
		const sdk = createAgentClientFrom(fake);
		await sdk.cancel("sess-2");
		expect(calls).toEqual([{ sessionId: "sess-2" }]);
	});
});
