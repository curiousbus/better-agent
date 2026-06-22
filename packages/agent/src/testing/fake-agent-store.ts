import type { AgentConfig } from "../agent/types";
import type { AgentStore } from "../ports";

function makeAgentTokenOps(
	map: Map<string, AgentConfig>,
	hashes: Map<string, string>
): Pick<AgentStore, "create" | "findByTokenHash" | "rotateToken"> {
	return {
		create({ tokenHash, ...rest }) {
			const now = new Date();
			const agent: AgentConfig = {
				id: crypto.randomUUID(),
				...rest,
				createdAt: now,
				updatedAt: now,
			};
			map.set(agent.id, agent);
			hashes.set(agent.id, tokenHash);
			return Promise.resolve(agent);
		},
		findByTokenHash(tokenHash) {
			const found = [...hashes].find(([, hash]) => hash === tokenHash);
			return Promise.resolve((found && map.get(found[0])) ?? null);
		},
		rotateToken(id, tokenHash) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			hashes.set(id, tokenHash);
			const updated: AgentConfig = { ...existing, updatedAt: new Date() };
			map.set(id, updated);
			return Promise.resolve(updated);
		},
	};
}

export function createFakeAgentStore(seed: AgentConfig[] = []): AgentStore {
	const map = new Map(seed.map((agent) => [agent.id, agent]));
	const hashes = new Map<string, string>(); // agentId -> tokenHash
	return {
		...makeAgentTokenOps(map, hashes),
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...map.values()]);
		},
		update(id, input) {
			const existing = map.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const updated: AgentConfig = {
				...existing,
				...input,
				updatedAt: new Date(),
			};
			map.set(id, updated);
			return Promise.resolve(updated);
		},
		delete(id) {
			map.delete(id);
			hashes.delete(id);
			return Promise.resolve();
		},
	};
}
