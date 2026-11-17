# Phase 3a build brief: anime catalogue + resolver (Claude + Astra)

Repo = current directory. Read `anime/DESIGN.md` first (song is the unit; kinds registry; seeds; built to grow). This step builds the data pipeline only, no UI. Node 18+, no dependencies, ES modules.

## Facts already checked by Claude (don't re-check)
- AnimeThemes API: Cloudflare challenge for scripts (503). Jikan: unreachable. AniList GraphQL (`https://graphql.anilist.co`): works. yt-dlp: not installed. So: no yt-dlp; fetch YouTube pages directly.
- `https://www.youtube.com/results?search_query=…` (UA `Mozilla/5.0`, `Accept-Language: en`) returns HTML with `var ytInitialData = {...};` containing `videoRenderer` objects. Fixture: `anime/test/fixtures/search-unravel.html`.
- `https://www.youtube.com/watch?v=ID` contains `ytInitialPlayerResponse` with `playabilityStatus.status` and `playabilityStatus.playableInEmbed`. Fixtures: `watch-ok.html` (WinBY_VCymA: OK + playableInEmbed true) and `watch-blocked.html` (_k7gZaDjTTM: embedding blocked; returns LOGIN_REQUIRED). Rule: playable = status "OK" AND playableInEmbed true. Anything else = not playable.
- Your sandbox has no network: build and unit-test offline against the fixtures. Claude runs the live resolve afterwards.

## Inputs (exist)
- `anime/data/kinds.json`: registry `[{id, label, addon, default, seed}]`.
- `anime/data/seeds/themes.txt`: `Artist | Song | Show | OP|ED|IN | year [| aka Alias1; Alias2]`.
- `anime/data/seeds/animated-mv.txt`: `Artist | Song | Source | MV | year [| aka …]`.
- `anime/data/overrides.json`: manual picks, never written by scripts: `{"Artist | Song": "VIDEO_ID" | null}` (null = drop).

## Build
1. `anime/scripts/lib.mjs` (pure, tested): `parseSeedLine`, `songKey` (stable id from artist+song, normalised: lowercase, accents stripped, punctuation collapsed), `extractInitialData(html)`, `videosFromSearch(data)` → `[{id, title, channel, channelId, verified, officialArtist, seconds, views}]`, `playability(html)` → `{status, embed}`, `classify(video, seed)` → `{kind: 'creditless'|'tv'|'mv'|'other', reject?: reason}`, `score(video, seed)`.
   - Reject: titles with AMV, cover, lyric/lyrics, nightcore, slowed, reverb, 1 hour/10 hours, reaction, piano, guitar, drum, karaoke, instrumental, 8D, fanmade/fan made, edit, "full version" when kind is theme and channel unknown, live/concert (unless seed says so), shorts (< 45 s), anything > 12 min.
   - creditless = title has creditless | non-credit | NCOP | NCED | "clean opening/ending" | ノンクレジット. tv = title has opening/ending/OP/ED/主題歌 and 60-150 s. mv = "music video"/MV/"official video", or official artist channel.
   - Trust: channel in `anime/data/channels.json` (create it: `{ "trusted": { "<channelId>": "name" }, "blocked": {} }`, start with an empty `trusted` and a `knownNames` list for first-run heuristics: Aniplex, Aniplex USA, TOHO animation, Crunchyroll, Netflix Anime, MAPPA, KADOKAWA, avex, Sony Music (Japan), Lantis, FlyingDog, Pony Canyon, KING RECORDS, Warner Bros. Japan, Toei Animation, Muse Asia, Ani-One Asia, TV TOKYO, NHK, Riot Games, League of Legends, Blizzard, Overwatch, plus "Topic" channels are NOT trusted), OR `verified`/`officialArtist` badge, OR channel name contains the seed artist name. Untrusted = rejected (flag it in the report with the best untrusted candidate, so a human can whitelist the channel).
   - Preference for `theme` kind: creditless > tv > mv (mv allowed, but marked). For `animated-mv` kind: mv from trusted channel.
   - Score ties: trusted allowlist > verified > name match; then views.
2. `anime/scripts/resolve.mjs`: reads kinds + seeds + overrides, keeps `anime/data/catalog.json` (only new/changed seed lines are searched; `--refresh` re-searches all; `--only "text"`). Per seed: up to 2 queries (theme: `"{Show} {opening|ending|insert song} {Song} creditless"`, then `"{Artist} {Song} {Show}"`; mv: `"{Artist} {Song} official music video"`), take up to 15 candidates, check playability for the top 4 trusted candidates in score order and pick the first playable. 600 ms between requests; cache raw pages in `anime/.cache/` (gitignored; add to root `.gitignore`).
   - catalog.json shape: `{ "generated": ISO, "songs": [ { "id", "artist", "title", "aliases": [], "kind": "theme"|"animated-mv", "show"|"source", "use": "OP"|"ED"|"IN"|"MV", "year", "video": { "id", "kind": "creditless"|"tv"|"mv", "channel", "channelId", "seconds", "checked": ISO } | null, "flag": null | "reason" } ] }`.
   - Writes `anime/REVIEW.md`: flagged rows first (no playable trusted video, untrusted best candidate, mv used for a theme), then all rows: song, chosen video link, channel, kind, seconds.
   - Prints summary: playable N / total, by kind, by video kind, flagged count.
3. Tests `anime/test/*.test.mjs` with `node --test anime/test/` against the fixtures. Then shrink the fixtures: replace the three big .html fixtures with minimal ones that still contain the needed JSON (keep < 60 KB each), and make sure tests still pass.
4. `anime/package.json` not needed; add an npm script in root `package.json`: `"anime:resolve": "node anime/scripts/resolve.mjs"`, and make root `npm test` also run `anime/test/*.test.mjs`.

## Don't
- No UI yet. Don't touch K-pop/Pop code. Don't edit seeds or overrides.json content.

## Done when
`npm test` passes (including the new anime tests) and `node anime/scripts/resolve.mjs --help` prints usage without network.

## Return
Max 20 lines: files, test counts, decisions you made.
