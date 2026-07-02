import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type AgentRow = Awaited<ReturnType<Client["agents"]["list"]>>[number];

export type UserSessionRow = Awaited<
	ReturnType<Client["userSessions"]["list"]>
>[number];

export type ComposioAccountRow = Awaited<
	ReturnType<Client["composio"]["listAccounts"]>
>[number];

export type ComposioToolkitRow = Awaited<
	ReturnType<Client["composio"]["toolkits"]>
>[number];

export type ComposioConnectionRow = Awaited<
	ReturnType<Client["composio"]["connections"]>
>[number];

export type McpServerRow = Awaited<
	ReturnType<Client["mcp"]["listServers"]>
>[number];
