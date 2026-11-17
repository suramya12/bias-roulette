# Phase 2 build brief: Top 100 Hangout + playback recovery (Claude + Astra)

Repo = current directory. Static site, ES modules, no build, no dependencies. Phase 1 (shipped) added `src/pull-machine.js`, used by K-pop Top 100 (`src/charts.js`) and Pop Top 100 (`pop/src/app.js`). Roulette modes already have an Auto menu (K-pop: `index.html` `#autoplay` ~line 107, logic in `src/main.js` "autoplay" section; Pop: `pop/index.html` `#rouletteTpl` `.autoplay`, logic in `pop/src/roulette.js`).

## Goal
Friends hanging out with the Top 100 running in the background: songs keep coming, each with a short spin, and a dead video never stalls the night.

## 1. Top 100 Auto (both sides)
- A compact **Auto** toggle next to Pull in each Top 100 (same look as each side's existing Auto pill; a single switch, no "same artist" here). Persist: K-pop store key `chart.auto` (via the existing `store`), Pop localStorage `encore.chartAuto`. Default off.
- When on and the current MV ends (player end callback): wait 1200 ms, then a **short pull**: `PullMachine.pull({ short: true })` = one full turn + offset in 1200 ms, same ease and ticks, the incoming glow still shows, then land and lift, then reveal and play straight away. No stamp, no confetti, no fanfare, no vibration, no 1300 ms hold. (The side keeps selection, cooldown, and the binder: a short pull still counts as collecting the card exactly like a manual pull.) Reduced motion: no spin, 350 ms fade, same as manual.
- A manual pull (button/ring/Enter/Space) is always the full ceremony, and it also works as **Skip** during Auto.
- Picking a chart row while Auto is on plays that row; when it ends, Auto continues from the deck.
- Auto never advances while that Top 100 is inactive or hidden (mode switched, genre switched, `document.hidden` is fine to keep playing audio, but don't start a spin in a hidden section). `deactivate()`/`cancel()` clear the Auto timer.
- Under the player, a one-line **Up next** is NOT needed (selection happens at pull time). Keep it simple.

## 2. Playback recovery (both Top 100s and both Roulettes)
- Video can't play (player fail callback): if Auto is on, advance after 4000 ms (as Roulette Auto already does).
- **3 failures in a row** (no successful start between them): stop advancing, show a short message in the existing player message area: "3 videos in a row wouldn't play here. Auto paused." plus a **Resume** button that clears the counter and pulls. A successful play start (YouTube state 1) resets the counter. Apply the same 3-strike rule to Roulette Auto on both sides (K-pop `autoNext` in `src/main.js`, Pop `autoNext` in `pop/src/roulette.js`).
- **Autoplay blocked by the browser**: K-pop's `src/player.js` already handles `onAutoplayBlocked` by showing a play button (~line 81). Port the same behaviour to Pop's `pop/src/player.js` (`createPlayer`): on `onAutoplayBlocked`, show a big "Tap to play" button over the player; tapping calls `playVideo()`. A blocked start is not a failure and doesn't count toward the 3 strikes.

## 3. K-pop Roulette Auto visible from the start
Today the K-pop Roulette Auto menu (`#autoplay`, `index.html` ~line 107) only shows on the result screen. Make the same menu reachable on the first Roulette screen too (near `#spinBtn`, line ~79), compact, one instance of the settings (both places reflect the same state; simplest: move the single `<details>` to a container visible in all Roulette phases). Pop's is already visible: don't change it.

## Don't
- Don't change Phase 1 manual-pull timing or celebrations. Don't touch data files, scripts, `anime/` (except nothing), READMEs (Claude does docs).
- No new dependencies.

## Tests and checks
- Add tests to `tests/pull-machine.test.mjs` for `pull({ short: true })`: duration 1200 ms, exactly one landing, no celebration calls, cancel mid-short-pull fires nothing.
- If the strike counter is pure logic, put it in a tiny shared module `src/strikes.js` (`createStrikes(limit = 3)` with `fail()`, `ok()`, `get out`) and test it.
- `npm test` (root) and `node --test` in `pop/` must pass; `node --check` on changed .js.

## Return
Max 30 lines: files changed (one line each), test pass counts, anything you decided differently and why.

## Astra's additions (adopted by both of us; these override anything above)
- Add `short` metadata to `onLand`/`onReveal`; suppress stamps in both callers while preserving collection writes. Skipping `#celebrate()` alone leaves K-pop’s landing stamp and Pop’s reveal stamp ([src/charts.js:190](src/charts.js#L190), [pop/src/app.js:140](pop/src/app.js#L140)).

- Explicitly add an `onPlay` callback to both player wrappers, fired on state 1. Neither currently exposes successful starts. Count each playback attempt’s failure once; ignore callbacks from replaced/stopped attempts ([src/player.js:110](src/player.js#L110), [pop/src/player.js:50](pop/src/player.js#L50)).

- Scope Pop’s Roulette Auto selectors before reusing `.autoplay` styling. `renderAuto()` currently visits every `.autoplay` and assumes two inputs; the new single-switch Top 100 control would break it ([pop/src/roulette.js:20](pop/src/roulette.js#L20)).

- Require one pending advance per playback attempt. Clear it on manual pull, row/Quick/Next selection, Auto-off, pool change, and mode exit; recheck identity before firing. Preserve Stop during spinning. Pop Roulette’s existing `stop()` only stops playback, leaving its timer alive ([pop/src/roulette.js:217](pop/src/roulette.js#L217)).

- Define startup and visibility recovery: enabling Auto without a playing track starts one short pull; hidden-tab endings retain one pending advance for return. Mode exit discards it. Restoring a saved preference must not unexpectedly start playback.

- Suppress automatic scrolling during short pulls; both reveal paths currently scroll every result, interrupting chart browsing ([src/charts.js:362](src/charts.js#L362), [pop/src/app.js:151](pop/src/app.js#L151)).

- Expand acceptance tests beyond animation/counter units: duplicate errors, successful-start reset, blocked autoplay, third-strike pause/Resume, manual Skip racing an advance, hidden-tab return, and mode-away/back with a pending timer. Require a visible paused state and keyboard-accessible Resume.

- Claude's tweak to the visibility rule: if the page is hidden (document.hidden) when an Auto advance is due, don't keep it pending: skip the animation entirely (no spin, rAF doesn't run in hidden tabs) and go straight to pick + reveal + play, so background music keeps going. Visible again = normal short pulls resume. Mode exit still discards any pending advance.
