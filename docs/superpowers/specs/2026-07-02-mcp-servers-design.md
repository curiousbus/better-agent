# Per-user MCP Servers (X/Twitter first) — design spec

**Goal:** Users can register remote MCP servers (name + URL + optional bearer token, stored encrypted in the DB) and wire them into their agents; the agent's turns then carry the MCP server's tools. X's hosted MCP (`https://api.x.com/mcp`, Streamable HTTP, app-only bearer) is the first-class preset; the mechanism is generic/configurable.

## Researched facts
- X hosted MCP: `https://api.x.com/mcp`, Streamable HTTP (protocol 2025-06-18), 200+ tools; read endpoints work with a static `Authorization: Bearer <app-only token>` header. Write endpoints need OAuth2 PKCE (local bridge) — OUT of scope v1. Secondary no-auth server: `https://docs.x.com/mcp`.
- Client: official `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` is fetch-based (Workers-compatible). Pin it in apps/server.

## Design (mirrors the composio pattern)
1. **DB**: `mcp_servers` table — `id`, `user_id` FK (owner), `name`, `url`, `auth_header_cipher` (SecretBox-encrypted `Bearer …`, nullable for no-auth servers), timestamps, index on user_id. `agents.mcp_server_ids` jsonb string[] default [].
2. **Ports/store**: `McpServerStore` (create w/ owner, listByUser, getById, getAuthHeader server-only, delete). `AgentInput/AgentConfig` gain `mcpServerIds`.
3. **Server service**: `McpService` in apps/server — `listTools(server)` / `execute(server, name, args)` using the MCP SDK client (initialize → tools/list → tools/call), 15s timeout, per-(serverId,authHash) client memoization like the composio resolver. `buildMcpToolDefs` maps MCP tools → runtime ToolDefs (name prefixing `MCP_{SERVER}_`? NO — keep original tool names; collisions are the user's configuration concern v1).
4. **Tool assembly**: `agentToolDefs` (user-sessions) adds per-linked-server `safeMcpDefs` (errors logged + swallowed, same as composio); `agents.tools` endpoint includes them (composer wrench popover shows MCP tools automatically).
5. **API router** `mcp` (authorizedUserProcedure, owner-scoped like composio): `listServers`, `createServer {name,url,bearerToken?}` (validates by connecting + tools/list, rolls back on failure), `deleteServer`, `tools {serverId}` (diagnostic listing, errors surfaced). Activity events on add/remove. `agents.create/update` reject foreign `mcpServerIds`.
6. **Web UI** (/integrations): new "MCP Servers" section — list (name, url, masked auth), add dialog with **presets**: "X (Twitter) API" (prefills url, asks for bearer token), "X Docs" (no auth), "Custom" (free-form); delete w/ confirm; per-server tools preview. Agent wizard Tools step gains an MCP servers checkbox list (own servers only).

## Out of scope v1
- OAuth2 PKCE user-context (X write actions), streaming MCP resources/prompts, tool-name collision namespacing.

## Global constraints
No `any`; magic numbers only -1/0/1; files ≤300; functions ≤50; deps pinned exact; migrations via drizzle-kit generate. Work on dev.

## Tasks
1. DB: mcp_servers + agents.mcp_server_ids (one migration), store + ports + fakes. Tests.
2. Server: MCP client service + resolver + ToolDef builder; wire agentToolDefs + agents.tools.
3. API: mcp router + ownership + agents link validation + activity. Tests.
4. Web: integrations MCP section (presets) + wizard field + tools preview.
