# Anime side: design v2 (Claude + Astra, merged)

Static site, `anime/` beside K-pop (root) and Pop (`pop/`). Genre menu gets a third entry; Anime reopens your last session.

## Rule zero: the unit is the song, never the show
The wheel holds openings, endings and insert songs, not anime. There is no "pick an anime" control, no show filter, no show browsing: choosing a show lets you settle into shows you already like, which kills the roulette. Great music cuts across genres, so every mode crosses shows.
- Never the same show twice in a row; a show cools down for ~10 songs.
- Behind the scenes, shows with many themes (Naruto, One Piece) are weighted down so they don't flood the wheel. This is invisible: the user only ever sees songs.
- Favourites (♥) are a keepsake list. They never steer what comes next.

## Entries
- **Surprise me**: one real wheel spin over songs, then play. Shows active filters (OP/ED/Insert, era) and how many songs qualify; offers to loosen filters when empty.
- **Keep this energy**: start from a song: search by song title or alias ("Fighting Dreamers", "Unravel"; typing a show name lists its songs, it never plays the show), or tap "Like this" on what's playing. **Anchor** (default): every next song is compared with the seed and must flow from the current one. **Journey**: drifts gradually. Random among strong matches, always from other shows. Line under the player: "Similar because: driving drums, shouted chorus".
- **Showcase**: curated sets, each pick with a one-line reason, no fake ranks:
  - **Legends**: outstanding openings overall.
  - **Kinetic action**, **Graphic invention**, **Visual storytelling**: animation first.
  Sequence director credits only where verified.
- **Hangout** (switch on any session): no repeated wheel ceremony, Up Next shows 3, big Skip/Pause, remembered volume.

## Controls
One big player. Visible: Save (♥ favourites), Skip, Pause, Hangout. Up Next tray: next 3, Anchor/Journey, More lift, Cool down, Different sound, More like this, Not this. History.
- Feedback steers the current session only; permanent exclusion needs an explicit action. Skip is neutral.
- TV-size sequences by default; full artist MVs opt-in. Credited TV cuts accepted, creditless preferred.
- Blocked autoplay (`onAutoplayBlocked`) shows a Resume button; a failed video advances; 3 failures in a row pause with a message.
- Filters: OP / ED / Insert; era.

## Data
Three records with stable ids: **song**, **theme appearance** (anime, OP/ED/insert, sequence number, version, year), **video** (kind: creditless / credited TV / artist MV, duration, reviewed channel id, last availability check). Franchise links (internal only: cooldown and weighting). Multilingual aliases. Studio labelled "studio" (from AniList), not as the sequence's maker.
Music fields (7): energy, pace, groove, mood, sound, vocal delivery, dynamic arc; each with source, confidence, manual override. (Astra wanted groove instead of mood; Claude kept both: mood is what people ask for, "something dark".)
Showcase membership and reasons. Static JSON; favourites and history in the browser.

Sources: hand-curated seed lists (AnimeThemes blocks scripts and Jikan was unreachable when checked on 2026-11-17; AniList works for show metadata later). Videos: YouTube pages read directly (no yt-dlp). Deliberate coverage of older, obscure, film and ED material, not just top-popularity shows.

## Videos
New anime resolver, not the K-pop one (it searches MV-first and trusts name-matching channels). Allowlist of reviewed rights-holder channel ids (Aniplex, TOHO animation, Crunchyroll, etc.), show- and theme-specific queries, embed check.

## Build order
1. Define the records; pick 40 stratified test songs (eras, OP/ED, popular/obscure, both named seeds).
2. Anime resolver + allowlist; measure playable rate, test playback on the owner's phone and laptop.
3. Tag the 40; build chains from Fighting Dreamers and Unravel; owner approves both 10-track chains.
4. Player, session engine, wheel, controls, failure recovery.
5. Curate Showcase; pass a 30-minute Hangout test; only then grow toward ~800 songs.

Spoiler filtering: not in v1, and no spoiler-safe promise.

## Animated music videos (add-ons)
Besides anime OP/ED/insert songs, the catalogue includes animated music videos that aren't anime themes, for example:
- KPop Demon Hunters songs
- League of Legends / K/DA / Arcane (POP/STARS, RISE, Enemy…)
- Overwatch music videos
- Linkin Park's animated videos (Breaking the Habit…)
- Daft Punk's Interstella 5555 videos
- Porter Robinson & Madeon "Shelter"
- Gorillaz
Record kind: `theme` (anime OP/ED/insert) or `animated-mv`. Rule zero still applies: song is the unit; same cooldown, same "Keep this energy" and Showcase (Eye candy is a natural home for them).
**Toggle:** one tiny switch near the filters, "+ Animated MVs", on by default, remembered in the browser. Off = they vanish from every wheel, chain and set. Not a show picker: it's one on/off for the whole add-on group.
Catalogue size: no cap (1,000+ fine); every entry must be worth its place. The 40-song test stays the playback/quality gate before scaling.

## Built to grow (pile on later)
The examples above are a start, not the list. Adding songs must be cheap and safe on any later day:
- **Seed lists, one line per song**, grouped by kind: `anime/data/seeds/themes.txt`, `anime/data/seeds/animated-mv.txt`, … Format: `Artist | Song | source/show | optional YouTube id`. Anyone can append lines; nothing else needs editing.
- **Incremental resolver**: like K-pop's `npm run resolve`, it only looks up new lines, keeps manual overrides in a separate file it never writes, and writes a review report (flagged matches first).
- **Kinds are a registry, not hard-coded**: `anime/data/kinds.json` lists each add-on group (id, label, default on/off). A new group (say game music videos or virtual-singer MVs) = one registry line + a seed file, and its tiny toggle appears automatically.
- **Tags are filled per song** (energy, mood…) by a tagging script that only tags untagged songs, so piling on doesn't redo old work.
- **Audit script** (like Pop's `scripts/audit.mjs`): fails on duplicate videos, songs with no playable video, untagged songs, or unknown kinds.
