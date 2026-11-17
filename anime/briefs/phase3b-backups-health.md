# Phase 3b brief: backup copies, fan fallback, health and cleanup (Claude draft for Astra)

Owner's asks (condensed):
- Fan uploads are OK if they have millions of views or have been up 3+ years.
- Like a torrent: each song should have 3-4 high-quality copies lined up, so if one dies the next plays instantly, and viewers can swipe between copies. Video quality must never be compromised. User experience above all.
- Clean up junk automatically: a copy that fails 3 times (in total, not in a row) gets booted; definite failures are booted at once.

## Copies queue (data)
`song.videos`: ordered list, up to 4, replaces `song.video` (keep `video` = videos[0] for compatibility until the UI is built).
Each copy: `{ id, kind: creditless|tv|mv, source: official|fan, channel, channelId, seconds, views, published, hd: true, checked }`.
Order: official creditless > official tv > official mv > fan creditless > fan tv (fan mv never for themes).

## Gates for every copy
- Junk filter (existing), embeddable (existing playability check).
- Quality: HD required. Check `https://i.ytimg.com/vi/ID/maxresdefault.jpg` → 200 means the upload is ≥ 720p (YouTube only makes maxres thumbnails for HD uploads); 404 = reject. If the watch page includes `streamingData.adaptiveFormats[].qualityLabel`, record the max (prefer 1080p+ when ranking).
- Fan copies additionally: views ≥ 1,000,000 AND published ≥ 3 years ago (both, not either: owner said "or"; Claude proposes AND for fan uploads, OR is too loose — decide with Astra), and title/channel must not look like a re-edit (sped up, nightcore, mirrored, "extended", "full", "lyrics").

## Player failover (UI phase, recorded here)
On a copy failing to play: switch to the next copy of the same song immediately (no 4 s wait); only after all copies fail does Auto move to the next song (that counts as one strike for the 3-in-a-row pause). A small ⇄ "other version" control flips copies by hand; the viewer's choice is remembered per song in localStorage. A copy that fails 3 times on this device is skipped locally (localStorage ledger).

## Health check and cleanup (`anime/scripts/health.mjs`)
- Re-checks every stored copy (playability + HD thumbnail). Ledger `anime/data/health.json`: per video id `{ strikes: [{at, reason}], booted?: {at, reason} }`.
- Definite failure → boot at once: removed/unavailable, private, account terminated, embedding disabled.
- Uncertain failure (other non-OK status, region block): +1 strike. 3 strikes total (not consecutive) → boot.
- Our own network/throttle errors never count.
- Booted ids go to `anime/data/channels.json`? no: to `health.json` `booted`, and the resolver must never pick a booted id again.
- After cleanup, refill: any song with < 4 copies gets re-searched for more (respecting all gates). Songs with 0 copies are listed in REVIEW.md as "set aside"; the seed line stays.
- Optional later (needs owner's yes): a scheduled GitHub Action runs health daily and commits.

## Pacing
YouTube throttles scripted runs (redirect loops). Requests ≥ 2.5 s apart, back off 15/45/120 s on redirects/429/network errors (already in resolve.mjs).

## Astra's changes (adopted by both; override anything above)
- **L16 — use OR:** `views ≥ 1,000,000 OR published ≤ today minus 3 calendar years`. Owner’s explicit rule wins. Read exact watch-page metadata; missing values remain unknown. Preserve blocked-channel exclusions; channel-name matches or verification badges alone must not establish `source: official`.

- **L15 — remove thumbnail-based acceptance/rejection.** `maxresdefault.jpg` is not a documented HD guarantee. Inspect video dimensions in both `streamingData.formats` and `adaptiveFormats` from the already-fetched page. Missing formats mean unknown, not SD. Optional keyed fallback: batched `videos.list` with `contentDetails.definition`. Store quality evidence and timestamp. [YouTube metadata](https://developers.google.com/youtube/data/reference/rest/v3/videos)

- **L5/L19 — replace “instantly” with “switch immediately; playback may buffer.”** Promise HD source availability, not uninterrupted HD delivery. Separate equivalent cuts from alternate versions: TV→full MV cannot preserve musical position. Resume only with verified alignment; otherwise restart with a clear version label.

- **L19 — define failover state:** attempt each ID once per song attempt; ignore stale callbacks; preserve mute, volume, and pause state. Remember selection by ID. Autoplay denial should show Play; error 153 should flag client configuration. Neither earns strikes. [Player errors](https://developers.google.com/youtube/iframe_api_reference#Events)

- **L22–26 — tighten evidence:** health checks bypass cached pages. Extend `playability()` to retain reasons and distinguish missing embed metadata from explicit denial. Generic “unavailable,” parsing failures, challenges, and regional restrictions must not trigger global bans. Count one qualifying strike per independent check, never per retry.

- **L16 — scope junk matching:** match edit markers outside known song/show titles; remove blanket channel-name and `full` rejection.

- **L9/L27 — specify refill mechanics:** collect distinct IDs beyond the current four-watch/first-success limit; preserve healthy copies on fetch failure. Respect null overrides, exclude `videos` from `seedFields()`, and invalidate resolver state when policy or health changes.
