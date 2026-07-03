# TweetCard genui component — report

## Status: DONE

## Files touched

- `apps/web/src/genui/manifest.ts` — modified. Added the `TweetCard` `ComponentDef`.
- `apps/web/src/genui/renderers.tsx` — modified. Registered `TweetCard: TweetCardNode` in `RENDERERS`, importing the renderer from the new file below. (No other renderer logic changed.)
- `apps/web/src/genui/tweet-card-node.tsx` — **new file**. Holds all TweetCard rendering logic (helpers + subcomponents + the exported `TweetCardNode`).
- Not touched, as instructed: `tools.ts`, `handlers.ts`, `config.ts`, `todo-store.ts`.

### Why a new file instead of inlining everything in `renderers.tsx`

Inlining the full TweetCard implementation pushed `renderers.tsx` to 363 lines, over the 299-line hard cap. Split it out to `tweet-card-node.tsx` (216 lines) and left `renderers.tsx` at 152 lines — importing `TweetCardNode` the same way the file already imports `TodoList` from `./todo-list`. This matches the existing repo convention of pulling non-trivial renderers into their own file.

## TweetCard props contract (for matching MCP tool output)

```ts
{
  authorName: string;              // required
  authorHandle: string;            // required, WITHOUT leading "@"
  authorAvatarUrl?: string;        // optional image URL
  verified?: boolean;              // shows a blue BadgeCheck next to the name
  text: string;                    // required, tweet body — newlines preserved
  postedAt?: string;               // optional ISO date string
  url?: string;                    // optional; if present, the whole card becomes a link (target="_blank", rel="noopener noreferrer")
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  viewCount?: number;
  mediaUrls?: string[];            // optional image URLs; capped at 4, rendered in a 2-col grid when >1
}
```

Description registered in the manifest: "A single tweet rendered as a card. When showing tweets from the X tools (x_search_tweets, x_user_tweets, x_search_users), render ONE TweetCard per tweet and fill its props from the tool result fields."

## Implementation notes

- **Structure**: Rounded bordered card (`rounded-xl border bg-card p-4 w-full max-w-md`), split into three ≤50-line subcomponents inside `tweet-card-node.tsx`: `TweetCardHeader` (avatar + name/verified + handle/relative time + a small brand-mark icon), `TweetCardBody` (text + `TweetCardMedia` grid), and `TweetCardStats` (reply/retweet/like/view, each via a `StatItem` helper that omits undefined values). `TweetCardNode` composes these and optionally wraps the whole card in an `<a>` when `url` is present.
- **Avatar**: `AuthorAvatar` renders an `<img className="size-10 rounded-full object-cover">` when `authorAvatarUrl` is set, else a muted circle with the author's first initial.
- **Brand icon substitution**: The task spec called for the lucide `Twitter` icon, but the installed `lucide-react` (both `0.546.0` and the workspace-resolved `1.18.0`) has **removed brand icons** — `Twitter` doesn't exist in v1. Used lucide's `X` icon instead (imported as `X as XLogo` to avoid shadowing patterns), which is the closest available icon to represent the platform and is what actually made `tsc` fail before the fix (`TS2305: Module '"lucide-react"' has no exported member 'Twitter'`).
- **Numbers/helpers**: `compactNumber(n)` (1234 → "1.2K", 1_200_000 → "1.2M") and `relativeTime(iso)` ("now"/"Nm"/"Nh"/"Nd", falling back to an `Intl.DateTimeFormat` short month/day beyond a 7-day window) are both top-level functions in `tweet-card-node.tsx`. No regex was needed for either, so the "top-level regex" constraint didn't come into play for this component.
- **No `any`**: uses the existing `str(v, fallback)` helper plus a new local `num(v)` helper (`typeof v === "number" ? v : undefined`) for numeric props.
- **Magic numbers**: all non -1/0/1 numeric literals are named constants — `KILO`, `MEGA`, `DECIMAL_ROUND`, `MAX_MEDIA`, `MS_PER_SECOND`, `SECONDS_PER_MINUTE`, `MINUTES_PER_HOUR`, `HOURS_PER_DAY`, `RECENT_DAYS_WINDOW`.
- **Images**: two raw `<img>` tags (avatar, media) are the only network-touching elements, as instructed. Biome's `lint/correctness/useImageSize` rule fires on `<img>` with no intrinsic dimensions (these are remote images sized purely via Tailwind classes), so each has a `biome-ignore lint/correctness/useImageSize: ...` comment — this is a new suppression pattern not previously used elsewhere in the repo (grepped first, found no precedent), but it was the correct/only rule actually firing (my first attempt suppressed a nonexistent `lint/performance/noImgElement` rule, which Biome flagged as a no-op suppression and had to be corrected).
- **No bracket-index-in-className**: none used; `gridClassName` for the media grid is computed into a local `const` before being passed to `className`.

## Check outputs

- `pnpm dlx ultracite fix apps/web/src/genui/manifest.ts apps/web/src/genui/renderers.tsx apps/web/src/genui/tweet-card-node.tsx` → `Checked 3 files in 14ms. No fixes applied.` (clean)
- `pnpm -F web check-types` → `tsc --noEmit` exits 0, no output.
- `npx eslint apps/web/src/genui/manifest.ts apps/web/src/genui/renderers.tsx apps/web/src/genui/tweet-card-node.tsx` → `ESLint: No issues found`
- `node scripts/check-tailwind.js apps/web/src/genui/renderers.tsx apps/web/src/genui/tweet-card-node.tsx` → `✅ Tailwind CSS 检查通过` (exit 0)
- `pnpm -F web test` → `Test Files 5 passed (5)`, `Tests 9 passed (9)` (includes the existing `renderers.test.ts` check that every `COMPONENT_TYPES` entry has a registered renderer — `TweetCard` now passes that assertion automatically).

## Line counts (≤299 cap)

- `apps/web/src/genui/renderers.tsx`: 152 lines
- `apps/web/src/genui/tweet-card-node.tsx`: 216 lines
- `apps/web/src/genui/manifest.ts`: 99 lines

No git commit was made, per instructions.
