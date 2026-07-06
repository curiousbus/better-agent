const DEFAULT_LIMIT_HINT = 5;

const LIMIT_PROP = {
	type: "number",
	description: `How many tweets to return (default ${DEFAULT_LIMIT_HINT}, max 20).`,
};

const HANDLE_PROP = {
	type: "string",
	description: "The user's @handle without the leading @.",
};

function handleTool(name: string, description: string) {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: { screen_name: HANDLE_PROP, limit: LIMIT_PROP },
			required: ["screen_name"],
			additionalProperties: false,
		},
	};
}

const TOOLS = [
	{
		name: "x_search_users",
		description:
			"Look up an X (Twitter) user by their @handle. Returns the profile: " +
			"display name, bio, follower/following/tweet counts, verified flag, " +
			"avatar and banner URLs.",
		inputSchema: {
			type: "object",
			properties: { screen_name: HANDLE_PROP },
			required: ["screen_name"],
			additionalProperties: false,
		},
	},
	{
		name: "x_search_tweets",
		description:
			"Search X (Twitter) posts matching a query (also finds people by display " +
			"name via their posts). Returns tweets with author, text, media, and " +
			"engagement counts.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "The search query." },
				product: {
					type: "string",
					enum: ["Latest", "Top"],
					description:
						"Latest (recent) or Top (most relevant). Default Latest.",
				},
				limit: LIMIT_PROP,
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	handleTool(
		"x_user_tweets",
		"Fetch a user's most recent tweets (originals + retweets), by @handle."
	),
	handleTool(
		"x_user_replies",
		"Fetch a user's recent tweets AND replies, by @handle."
	),
	handleTool(
		"x_user_media",
		"Fetch a user's recent media tweets (photos/videos), by @handle."
	),
	handleTool("x_followers", "List a user's followers (profiles), by @handle."),
	handleTool(
		"x_following",
		"List the accounts a user follows (profiles), by @handle."
	),
	{
		name: "x_tweet_thread",
		description:
			"Fetch a specific tweet and its conversation thread by tweet id.",
		inputSchema: {
			type: "object",
			properties: {
				tweet_id: { type: "string", description: "The tweet's numeric id." },
				limit: LIMIT_PROP,
			},
			required: ["tweet_id"],
			additionalProperties: false,
		},
	},
] as const;

export const TOOL_NAMES = new Set<string>(TOOLS.map((tool) => tool.name));
export { TOOLS };
