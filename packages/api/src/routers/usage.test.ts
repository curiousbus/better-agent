import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const USER = { id: "u1", email: "u@x.com", createdAt: new Date() };

function buildClient(
	daily: Array<{
		costCents: number;
		day: string;
		inputTokens: number;
		outputTokens: number;
		turns: number;
	}>
) {
	const services = {
		authz: { enabled: false },
		stores: {
			activity: { log: () => Promise.resolve() },
			usage: { dailySummary: () => Promise.resolve(daily) },
		},
	};
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

it("summary returns the daily rows and summed totals for the window", async () => {
	const client = buildClient([
		{
			day: "2026-06-29",
			inputTokens: 10,
			outputTokens: 5,
			costCents: 1,
			turns: 1,
		},
		{
			day: "2026-06-30",
			inputTokens: 20,
			outputTokens: 10,
			costCents: 2,
			turns: 3,
		},
	]);
	const res = await client.usage.summary({ windowDays: 7 });
	expect(res.windowDays).toBe(7);
	expect(res.daily).toHaveLength(2);
	expect(res.totals).toEqual({
		inputTokens: 30,
		outputTokens: 15,
		costCents: 3,
		turns: 4,
	});
});
