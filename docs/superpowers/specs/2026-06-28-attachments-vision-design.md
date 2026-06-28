# Attachments + Vision — Design Spec

**Date:** 2026-06-28
**Status:** Approved direction (R2 storage); building to production standard.

## Goal

Let a user attach **images** to a chat turn, store them durably, and pass them to
vision-capable models so the agent can actually see them. Built so non-image files
extend cleanly later. Production standard — no shortcuts.

## Scope

In: image upload (png/jpeg/webp/gif), R2 storage, message `file` parts, vision
wiring to the model, composer UI (pick/preview/remove), image render in the
transcript (incl. history), client SDK support.

Out (separate features): image **generation**, audio, non-image file content sent
to the model (stored + shown, but only images are sent as model content for now),
RAG.

## Architecture

### Storage — R2 (approved) + Postgres metadata
- Bytes live in an **R2 bucket** (binding `UPLOADS`); object key `attachments/{sessionId}/{id}`.
- Metadata in Postgres `attachments` (id, session_id, message_id?, r2_key, mime, name, size, created_at) with indexes on message_id + session_id.
- `AttachmentStore` port abstracts storage: `create`, `getById`, `getBytes`, `linkToMessage`, `listByMessage`. Implemented in the server, composing the DB metadata repo + the R2 binding. The agent depends only on the port.

### Upload — oRPC native `File` (NOT base64)
- `attachments.upload({ sessionId, file })` and a user-plane equivalent. Binary multipart via oRPC; reuses existing auth; validates: session ownership, mime allowlist, size cap (8 MB), magic-byte sniff matching the claimed image mime. Puts to R2, inserts the row (message_id null), returns the attachment metadata.

### Serve — oRPC binary response, authed
- `attachments.get({ id })` returns the bytes (Blob), authed + ownership-checked. The UI fetches with auth and renders via `URL.createObjectURL` — no token in URLs, works for history. (Presigned R2 URLs deliberately NOT used; see Decisions.)

### Message model
- New part type `file`; `FilePartContent { attachmentId, mime, name }`. Added to `MessagePartType`, `MessagePartContent`, the `MessagePart` discriminated union (`packages/agent/src/session/types.ts`).
- `persistUserTurn` links the turn's `attachmentIds` (`AttachmentStore.linkToMessage`) and appends a `file` part per attachment alongside the text part.

### Vision wiring
- `RunTurnInput.attachmentIds?: string[]`; threaded from the prompt/run input through the runtime to `persistUserTurn`.
- `buildTurnMessages` resolves image bytes for `file` parts in the (post-compaction) history via the `AttachmentStore` and passes a `Map<attachmentId, {mime, data}>` into `toModelMessages`.
- `toModelMessages` builds AI-SDK user content arrays: `[{type:'text', text}, {type:'image', image: Uint8Array, mediaType: mime}, …]`. Only image mimes become image parts. (AI SDK v5 `ModelMessage` user content.)

### API surface
- New `attachments` router (`upload`, `get`). `prompt`/`run` on both `sessions` (agent) and `user-sessions` (web) gain `attachmentIds?: string[]`, passed into `runtime.runTurn`.

### Worker / config
- `wrangler.toml` `[[r2_buckets]] binding = "UPLOADS"`. `worker.ts` `WorkerEnv.UPLOADS` → `buildServices` → `AttachmentStore`. Deploy Action idempotently creates the bucket (`wrangler r2 bucket create … || true`).

### UI
- Composer: an image-picker button → on select, upload via oRPC → show an `attachment.tsx` chip (uploading → done / error) with a remove control → on send, include `attachmentIds`.
- Render: image `file` parts in a message render as thumbnails (authed fetch → object URL), in live turns and replayed history.

### Client SDK
- `RunOptions.attachmentIds?: string[]` (forwarded to run/prompt). Upload helper deferred (web uses the oRPC client directly).

## Decisions (and what's deliberately NOT done)

- **Presigned R2 URLs / R2 S3 credentials — NOT used.** For small images, a worker
  proxying bytes to/from R2 via the binding is production standard and needs no extra
  secret or bucket CORS. Presigned direct-to-R2 is an over-optimization for this scale;
  revisit only for large files / high upload concurrency. (待定 if the user wants it.)
- **Cost note (inherent, not infra):** vision re-sends image bytes to the model with
  each turn's context — image tokens are expensive, so per-turn cost rises while images
  are in the active window; compaction drops old turns over time.

## Follow-ups (noted, not blocking)
- Orphaned-attachment cleanup: uploads that are never sent (message_id stays null) accumulate. Add a scheduled cleanup (cron) deleting unlinked rows + R2 objects older than N hours.
- Non-image files as model content (AI SDK `file` parts) where the provider supports it.

## Testing / verification
- Unit: `to-model-messages` builds image content for image `file` parts given the resolved map; `persistUserTurn` links attachments + writes `file` parts.
- Repo build/typecheck/test green; web build green; migration generated + committed.
- Manual (user, on the deployed env after R2 setup): upload an image in chat, send, confirm the model can describe it; reload and confirm the image still renders from history.

## User setup required (R2)
- An R2 bucket reachable by the server worker (the deploy Action attempts to create it; if the CF token lacks R2 permission, run `wrangler r2 bucket create <name>` once).
- Confirm the `CLOUDFLARE_API_TOKEN` has R2 read/write.
