import type { SettingsStore } from "@better-agent/agent/ports";
import { composioKeyName } from "@better-agent/agent/tool/composio-tools";
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

it("returns a non-null service when the settings store has a key for the user", async () => {
	const settings = makeSettings({ [composioKeyName("u1")]: "test-key-abc" });
	const resolve = buildComposioResolver(settings);
	const svc = await resolve("u1");
	expect(svc).not.toBeNull();
});

it("returns the same service instance on two calls with the same key", async () => {
	const settings = makeSettings({ [composioKeyName("u1")]: "stable-key" });
	const resolve = buildComposioResolver(settings);
	const first = await resolve("u1");
	const second = await resolve("u1");
	expect(first).toBe(second);
});

it("returns null for a user with no key", async () => {
	const settings = makeSettings({ [composioKeyName("u1")]: "key-for-u1" });
	const resolve = buildComposioResolver(settings);
	const svc = await resolve("u2");
	expect(svc).toBeNull();
});

it("returns a different instance after the settings key changes", async () => {
	const settings = makeSettings({ [composioKeyName("u1")]: "key-v1" });
	const resolve = buildComposioResolver(settings);
	const first = await resolve("u1");
	settings.data.set(composioKeyName("u1"), "key-v2");
	const second = await resolve("u1");
	expect(second).not.toBe(first);
	expect(second).not.toBeNull();
});
