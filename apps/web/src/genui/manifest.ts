import type { ComponentDef } from "@curiousbus/agent-client";
import { z } from "zod";

const props = (shape: z.ZodRawShape): Record<string, unknown> =>
	z.toJSONSchema(z.object(shape)) as Record<string, unknown>;

export const MANIFEST: ComponentDef[] = [
	{
		type: "TodoList",
		description:
			"A real, interactive todo list the user can add/check-off/delete in directly. Render this whenever the user wants to see or manage their todos. It reads the live todo store — no props or data needed.",
		props: props({}),
	},
	{
		type: "Stack",
		description:
			"Vertical or horizontal layout container for other components.",
		props: props({ direction: z.enum(["vertical", "horizontal"]).optional() }),
		children: true,
	},
	{
		type: "Card",
		description: "A titled surface that groups related content.",
		props: props({ title: z.string().optional() }),
		children: true,
	},
	{
		type: "Heading",
		description: "A short section heading.",
		props: props({ text: z.string() }),
	},
	{
		type: "Text",
		description: "A paragraph of body text.",
		props: props({ text: z.string() }),
	},
	{
		type: "Badge",
		description: "A small status label.",
		props: props({
			label: z.string(),
			tone: z.enum(["neutral", "success", "warning"]).optional(),
		}),
	},
	{
		type: "Stat",
		description: "A single labeled metric value.",
		props: props({ label: z.string(), value: z.string() }),
	},
	{
		type: "List",
		description: "A bulleted list of short text items.",
		props: props({ items: z.array(z.string()) }),
	},
	{
		type: "Button",
		description: "A clickable button that emits the 'press' action.",
		props: props({ label: z.string() }),
		actions: ["press"],
	},
	{
		type: "Form",
		description:
			"A form wrapper; renders child TextFields and a submit button that emits 'submit'.",
		props: props({ submitLabel: z.string().optional() }),
		children: true,
		actions: ["submit"],
	},
	{
		type: "TextField",
		description: "A labeled single-line text input inside a Form.",
		props: props({
			name: z.string(),
			label: z.string(),
			placeholder: z.string().optional(),
		}),
	},
	{
		type: "TweetCard",
		description:
			"A single tweet rendered as a card. When showing tweets from the X tools (x_search_tweets, x_user_tweets, x_search_users), render ONE TweetCard per tweet and fill its props from the tool result fields.",
		props: props({
			authorName: z.string(),
			authorHandle: z.string(),
			authorAvatarUrl: z.string().optional(),
			verified: z.boolean().optional(),
			text: z.string(),
			postedAt: z.string().optional(),
			url: z.string().optional(),
			likeCount: z.number().optional(),
			retweetCount: z.number().optional(),
			replyCount: z.number().optional(),
			viewCount: z.number().optional(),
			mediaUrls: z.array(z.string()).optional(),
		}),
	},
];

export const COMPONENT_TYPES: string[] = MANIFEST.map((d) => d.type);
