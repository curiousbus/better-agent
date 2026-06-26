import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type ProviderCatalogRow = Awaited<
	ReturnType<Client["providers"]["catalogList"]>
>[number];

export type CredentialRow = Awaited<
	ReturnType<Client["providers"]["credentialsList"]>
>[number];

export type ModelRow = Awaited<
	ReturnType<Client["providers"]["modelsList"]>
>[number];

export type AgentRow = Awaited<ReturnType<Client["agents"]["list"]>>[number];

export type ComposioAccountRow = Awaited<
	ReturnType<Client["composio"]["listAccounts"]>
>[number];

export type ComposioToolkitRow = Awaited<
	ReturnType<Client["composio"]["toolkits"]>
>[number];

export type ComposioConnectionRow = Awaited<
	ReturnType<Client["composio"]["connections"]>
>[number];

export type SessionRow = Awaited<
	ReturnType<Client["sessions"]["list"]>
>[number];

export type SessionMessageRow = Awaited<
	ReturnType<Client["sessions"]["listMessages"]>
>[number];
