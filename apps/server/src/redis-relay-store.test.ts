import {
	MAX_WINDOW,
	type RelayEvent,
} from "@better-agent/agent/bridge/relay-store";
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisRelayStore } from "./redis-relay-store";

// ioredis-mock v8 shares a single in-process data store (and pub/sub bus)
// across every instance created with `new RedisMock()` — so each test below
// uses its own session id to avoid cross-test key collisions.
const WAIT_MS = 5;
const SECOND_ID = 2;
const THIRD_ID = 3;
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

it("append returns monotonically increasing ids and read replays them in order", async () => {
	const store = createRedisRelayStore(new RedisMock());

	const id1 = await store.append("append-read", "events", { n: 1 });
	const id2 = await store.append("append-read", "events", { n: SECOND_ID });

	expect(id1).toBe(1);
	expect(id2).toBe(SECOND_ID);
	await expect(store.read("append-read", "events", 0)).resolves.toEqual([
		{ id: 1, data: { n: 1 } },
		{ id: 2, data: { n: 2 } },
	]);
});

it("read filters to ids strictly greater than afterId", async () => {
	const store = createRedisRelayStore(new RedisMock());
	await store.append("after-id", "events", "a");
	await store.append("after-id", "events", "b");
	await store.append("after-id", "events", "c");

	await expect(store.read("after-id", "events", 1)).resolves.toEqual([
		{ id: 2, data: "b" },
		{ id: 3, data: "c" },
	]);
	await expect(store.read("after-id", "events", THIRD_ID)).resolves.toEqual([]);
});

it("caps the replay window at MAX_WINDOW, dropping the oldest events", async () => {
	const store = createRedisRelayStore(new RedisMock());
	const overflow = 10;
	const total = MAX_WINDOW + overflow;
	for (let i = 0; i < total; i++) {
		await store.append("window-cap", "events", i);
	}

	const events = await store.read("window-cap", "events", 0);
	expect(events).toHaveLength(MAX_WINDOW);
	expect(events[0]?.id).toBe(overflow + 1);
	expect(events.at(-1)?.id).toBe(total);
});

it("isolates ids and events between dirs and sessions", async () => {
	const store = createRedisRelayStore(new RedisMock());
	await store.append("isolation-1", "events", "e1");
	await store.append("isolation-1", "commands", "c1");
	await store.append("isolation-2", "events", "other-session");

	await expect(store.read("isolation-1", "events", 0)).resolves.toEqual([
		{ id: 1, data: "e1" },
	]);
	await expect(store.read("isolation-1", "commands", 0)).resolves.toEqual([
		{ id: 1, data: "c1" },
	]);
	await expect(store.read("isolation-2", "events", 0)).resolves.toEqual([
		{ id: 1, data: "other-session" },
	]);
});

it("subscribe receives appended events live (cross-connection); unsubscribe stops delivery", async () => {
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const subscriberStore = createRedisRelayStore(redisA);
	const appenderStore = createRedisRelayStore(redisB);
	const received: RelayEvent[] = [];

	const unsubscribe = subscriberStore.subscribe(
		"live-push",
		"events",
		(event) => {
			received.push(event);
		}
	);
	await wait(WAIT_MS);

	await appenderStore.append("live-push", "events", "first");
	await wait(WAIT_MS);
	unsubscribe();
	await appenderStore.append("live-push", "events", "second");
	await wait(WAIT_MS);

	expect(received).toEqual([{ id: 1, data: "first" }]);
});

it("subscribers are scoped to their own session/dir channel", async () => {
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const subscriberStore = createRedisRelayStore(redisA);
	const appenderStore = createRedisRelayStore(redisB);
	const eventsReceived: RelayEvent[] = [];
	const commandsReceived: RelayEvent[] = [];

	subscriberStore.subscribe("channel-scope", "events", (event) =>
		eventsReceived.push(event)
	);
	subscriberStore.subscribe("channel-scope", "commands", (event) =>
		commandsReceived.push(event)
	);
	await wait(WAIT_MS);

	await appenderStore.append("channel-scope", "events", "e");
	await appenderStore.append("channel-scope", "commands", "c");
	await wait(WAIT_MS);

	expect(eventsReceived).toEqual([{ id: 1, data: "e" }]);
	expect(commandsReceived).toEqual([{ id: 1, data: "c" }]);
});
