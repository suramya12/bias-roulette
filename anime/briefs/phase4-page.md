# Phase 4 brief: the Anime page, v1 "Surprise me" (design: Claude; code: Sol)

Owner's asks (condensed): click the randomizer and get an outstanding opening, ending or animated MV; the gambler feel of the K-pop Top 100 ring; song is the unit, never the show (no anime picker); tiny non-intrusive "+ Animated MVs" toggle; backup copies swappable "with the snap of a finger"; user experience first.

v1 scope: Surprise me ring + Auto + copy failover/swap + filters. Not in v1 (need tags/curation first): Keep this energy, Showcase, Hangout, favourites.

## Look (decided; build exactly this)
- Benchmark: the Pop Top 100 ring page (owner-approved). Same layout, ring, header, controls, spacing and type. Only the accent and the copy change.
- Feel: a late-night anime TV block. Deep ink background (keep Pop's dark stage), one accent: on-air red `#ff2d55` for the Pull button, the active chip, the playing badge and the ring glow. No new gradients, no extra colours; tier colours stay as PullMachine already draws them.
- Badges OP / ED / IN / MV look like broadcast slot labels: small caps, letter-spaced, 1 px accent border, no fill (filled accent when that song is playing).
- Ring cards: the thumbnail fills the card, a dark bottom scrim, title in bold (2 lines max, ellipsis), show/source in small muted text, badge top-left, year top-right.
- Header line under the genre menu: "Openings, endings & animated MVs" in muted small text. Pull button text: "Pull".
- Now playing (under the player): title large, artist after an em dash, then a muted line "Naruto · Opening · 2004" (IN = "Insert song", MV = "Animated MV"), then a small row: copy label and the ⇄ "Version 2 of 3" ghost button (hidden with one copy).
- Filters: one quiet row of small pill chips, never louder than the Pull button; the add-on switch is the smallest control on the page.

## Files
- `anime/index.html`, `anime/styles.css`: same look and header as `pop/index.html` / `pop/styles.css` (Top 100 section: `.ring-stage`, `.ring`, `.ring-hit`, `.pull`, Auto switch, sound toggle, genre menu). No Roulette/Top 100 tabs, no binder.
- `anime/src/engine.js`: pure logic, no DOM, fully tested.
- `anime/src/app.js`: wiring only.
- Genre menu: add "Anime" to `index.html` (href `anime/`) and `pop/index.html` (href `../anime/`); the anime page links back to K-pop and Pop in the mode closest to the ring (Top 100), following how the two pages already set those hrefs.
- `anime/test/engine.test.mjs`; docs: `anime/README.md` (page section), root `README.md` table row.

Reuse, don't copy: `src/pull-machine.js` (ring), `src/sound.js`, `src/auto-advance.js`, `src/strikes.js`, and the YouTube player Pop's Top 100 uses (`pop/src/player.js`). Don't change shared modules; if a small backwards-compatible hook is unavoidable, keep K-pop and Pop behaviour identical and report it.

## Data
`anime/data/catalog.json` → `songs[]`: `{ id, artist, title, aliases, kind, show | source, use: OP|ED|IN|MV, year, videos: [ { id, kind: creditless|tv|mv, source: official|fan, views, ... } ] }` (videos best first; `video` = videos[0]). `anime/data/kinds.json` → `[ { id, label, addon, default, seed } ]`. Only songs with `videos.length > 0` are playable.

## engine.js
- `eligible(songs, { uses, addons, kinds })`: playable songs; kinds with `addon: false` filtered by `uses` (Set of OP/ED/IN); `addon: true` kinds included only when `addons[kind.id]` is on (default from kinds.json). Unknown kinds excluded.
- `franchise(song)`: `(song.show ?? song.source)` lowercased and trimmed. Internal only; never shown as a control.
- `pickNext(pool, history, rand)`: `history` = played song ids, newest last. Never the same franchise as the last song when another franchise exists. Avoid franchises from the last 10 plays; relax 10 → 5 → 1 only when nothing is left. Avoid songs from the last `min(20, pool.length - 1)` plays. Weight = `1 / sqrt(songs of that franchise in pool)`, so big franchises don't flood. `rand()` injected (crypto in the app).
- `tierOf(song)`: max views over the song's copies: ≥ 100M legendary, ≥ 20M epic, ≥ 3M rare, else common. Use the tier ids PullMachine/Pop already use.
- `copyQueue(song, { preferredId, localStrikes })`: copies in catalogue order, the preferred id first; drop copies with ≥ 3 local strikes, unless that leaves none (then keep all).
- `copyLabel(video)`: `Creditless` / `TV version` / `Music video`, plus ` · official` or ` · fan upload`.

## app.js behaviour
- Ring cards: thumbnail `https://i.ytimg.com/vi/<videos[0].id>/mqdefault.jpg`, title, show/source, badge OP/ED/IN/MV, year. Pool via `machine.setPool(items, pick)` with `pickNext`.
- Reveal → play `copyQueue[0]`. Under the player: "Title — Artist", "Show · OP · 2004", the copy label, and ⇄ "Other version 2/3" (hidden for one copy). ⇄ loads the next copy at once (wraps), remembered in localStorage `anime.copy.<songId>`. Switching restarts the video: never pretend positions line up.
- A copy fails → +1 in localStorage `anime.strikes` `{ videoId: count }` → immediately the next untried copy of the same song (each copy once per song attempt; stale callbacks ignored). All copies failed → the existing "can't play here" fallback with a YouTube link; with Auto on, one strike (`createStrikes`), next song after 4 s, 3 failed songs in a row pause Auto with Resume (as Pop Top 100).
- Autoplay blocked → Tap to play (not a strike). Error 153 = client configuration, not a strike.
- Video ends → Auto on: `pull({ short: true })` (immediate when the tab is hidden), as Pop.
- Filters under Pull, small: chips OP / ED / Insert (at least one stays on), then for each `addon: true` kind a tiny switch "+ <label>" (remembered `anime.addon.<id>`), then "N songs". Zero songs → "No songs match. Turn a filter back on." and Pull disabled.
- Remembered: `anime.auto`, `anime.sound`, `anime.uses`.
- No show picker, no show search, nothing that selects an anime.
- Fits 375 px, no horizontal scroll; Lite mode respected.

## Done when
`node --test tests/ anime/test/` passes; the page served by `npm start` at `/anime/` pulls, plays, swaps copies, fails over, and Auto-chains; K-pop and Pop pages unchanged except the menu link.
