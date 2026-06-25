export interface Titler {
	title(input: {
		providerId: string;
		modelId: string;
		userText: string;
	}): Promise<string>;
}

/** Generate a title only for the first turn; failures degrade to null (never fail the turn). */
export function maybeTitle(
	deps: { titler?: Titler },
	session: { title: string | null },
	agent: { providerId: string; modelId: string },
	userText: string
): Promise<string | null> {
	if (session.title != null || !deps.titler) {
		return Promise.resolve(null);
	}
	return deps.titler
		.title({ providerId: agent.providerId, modelId: agent.modelId, userText })
		.catch(() => null);
}
