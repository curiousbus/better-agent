// The terminal's view of the network: SSE connect, poll-fallback observe, and
// sendInput. Isolated behind this interface so `useBridgeTerminal` (and the
// components that use it) can be exercised in tests against a fake transport
// instead of a real fetch/oRPC round trip — mirrors how `Conversation` takes
// an injected `AgentClient` (see packages/ui/src/components/chat).

import { client } from "@/utils/orpc";
import type { RawBridgeEvent } from "./bridge-events";
import { connectBridgeStream } from "./sse-client";

export interface ConnectStreamArgs {
	afterId: number;
	onError: () => void;
	onEvent: (raw: RawBridgeEvent) => void;
	onOpen: () => void;
	sessionId: string;
}

export interface BridgeTransport {
	connectStream: (args: ConnectStreamArgs) => () => void;
	observe: (input: {
		afterId: number;
		sessionId: string;
	}) => Promise<RawBridgeEvent[]>;
	sendInput: (input: { data: unknown; sessionId: string }) => Promise<void>;
}

export function createBridgeTransport(): BridgeTransport {
	return {
		connectStream: ({ sessionId, afterId, onEvent, onOpen, onError }) =>
			connectBridgeStream(sessionId, afterId, {
				onEvent,
				onOpen,
				onError,
			}),
		observe: (input) => client.bridge.observe(input),
		sendInput: async (input) => {
			await client.bridge.sendInput(input);
		},
	};
}
