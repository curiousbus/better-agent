import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

const MISSING_AGENT = /--agent is required/;
const UNKNOWN_AGENT = /Unknown --agent/;
const MISSING_TOKEN = /--token is required/;
const MISSING_SERVER = /--server is required/;
const MISSING_VALUE = /Missing value for --agent/;

const BASE = [
	"--agent",
	"claude-code",
	"--token",
	"bt_abc",
	"--server",
	"https://bridge.example.com",
];

describe("parseArgs - accepted input", () => {
	it("parses all flags", () => {
		const args = parseArgs(
			[...BASE, "--dir", "/repo", "--label", "my repo"],
			{}
		);
		expect(args).toEqual({
			agentKind: "claude-code",
			token: "bt_abc",
			serverUrl: "https://bridge.example.com",
			dir: "/repo",
			label: "my repo",
		});
	});

	it("defaults dir to the current working directory and label to undefined", () => {
		const args = parseArgs(BASE, {});
		expect(args.dir).toBe(process.cwd());
		expect(args.label).toBeUndefined();
	});

	it("accepts pi as an agent kind", () => {
		const args = parseArgs(
			["--agent", "pi", "--token", "t", "--server", "s"],
			{}
		);
		expect(args.agentKind).toBe("pi");
	});

	it("falls back to env vars for token and server", () => {
		const args = parseArgs(["--agent", "opencode"], {
			BETTER_AGENT_BRIDGE_TOKEN: "bt_env",
			BETTER_AGENT_BRIDGE_SERVER: "https://env.example.com",
		});
		expect(args.token).toBe("bt_env");
		expect(args.serverUrl).toBe("https://env.example.com");
	});

	it("prefers an explicit flag over the env var", () => {
		const args = parseArgs(BASE, { BETTER_AGENT_BRIDGE_TOKEN: "bt_env" });
		expect(args.token).toBe("bt_abc");
	});
});

describe("parseArgs - rejected input", () => {
	it("rejects a missing --agent", () => {
		expect(() => parseArgs(["--token", "bt_abc", "--server", "s"], {})).toThrow(
			MISSING_AGENT
		);
	});

	it("rejects an unknown agent kind", () => {
		expect(() =>
			parseArgs(["--agent", "gpt5", "--token", "t", "--server", "s"], {})
		).toThrow(UNKNOWN_AGENT);
	});

	it("rejects a missing token with no env fallback", () => {
		expect(() => parseArgs(["--agent", "codex", "--server", "s"], {})).toThrow(
			MISSING_TOKEN
		);
	});

	it("rejects a missing server with no env fallback", () => {
		expect(() => parseArgs(["--agent", "codex", "--token", "t"], {})).toThrow(
			MISSING_SERVER
		);
	});

	it("rejects a flag with a missing value", () => {
		expect(() => parseArgs(["--agent"], {})).toThrow(MISSING_VALUE);
	});
});
