import type { SettingsStore } from "@better-agent/agent/ports";
import { expect, it } from "vitest";
import { buildComposioResolver } from "./optional-services";

function makeSettings(initial?: Record<string, string>): SettingsStore & {
	data: Map<string, string>;
} {
	const data = new Map<string, string>(
		initial ? Object.entries(initial) : undefined
	);
	return {
		data,
		get(key) {
			return Promise.resolve(data.get(key) ?? null);
		},
		set(key, value) {
			data.set(key, value);
			return Promise.resolve();
		},
		delete(key) {
			data.delete(key);
			return Promise.resolve();
		},
	};
}

it("returns a non-null service when the settings store has a key", async () => {
	const settings = makeSettings({ COMPOSIO_API_KEY: "test-key-abc" });
	const resolve = buildComposioResolver(settings);
	const svc = await resolve();
	expect(svc).not.toBeNull();
});

it("returns the same service instance on two calls with the same key", async () => {
	const settings = makeSettings({ COMPOSIO_API_KEY: "stable-key" });
	const resolve = buildComposioResolver(settings);
	const first = await resolve();
	const second = await resolve();
	expect(first).toBe(second);
});

it("returns a different instance after the settings key changes", async () => {
	const settings = makeSettings({ COMPOSIO_API_KEY: "key-v1" });
	const resolve = buildComposioResolver(settings);
	const first = await resolve();
	settings.data.set("COMPOSIO_API_KEY", "key-v2");
	const second = await resolve();
	expect(second).not.toBe(first);
	expect(second).not.toBeNull();
});
