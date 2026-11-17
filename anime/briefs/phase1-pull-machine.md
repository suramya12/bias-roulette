# Phase 1 build brief: shared Pull Machine (written by Claude + Astra)

You are Sol, building this for the team. Repo = current directory. Static site, ES modules, no build, no dependencies. Two sides: K-pop (root `index.html`, `styles.css`, `src/`) and Pop (`pop/index.html`, `pop/styles.css`, `pop/src/`). Pop already imports shared root code (`pop/src/stage.js` imports `../../src/fx.js`).

## Goal
The K-pop Top 100 "pull" (photocard ring, `src/charts.js` class `Charts`, `pull()` ~line 343) is the benchmark feel: click → ring spins 3 turns in 3600 ms with quartic ease-out and a tick per card → winner lifts → tier stamp → confetti + fanfare → 1300 ms hold → card reveal and MV plays. Extract it into one shared module and use it for both Top 100s. Pop Top 100 (`pop/src/app.js` ~lines 98-150, CSS ring `pop/styles.css:179-186`) currently has no spin: tap = instant reveal of the front card, with a CSS `spinRing` animation. Replace that.

## New: `src/pull-machine.js`
`export class PullMachine`
- constructor `{ ring, hit, buttons, slots = 14, radius, renderSlot(el, item), sound, onLand(item, tier), onReveal(item) , tierOf(item), say(text) }`
  - `ring`: the 3D ring element. `hit`: an element covering the ring that acts as one big button (role=button, tabindex=0). `buttons`: the Pull button(s) whose label switches between their normal text and "Stop" while spinning.
  - `renderSlot(el, item)` draws a card face for an item into a slot (side-specific renderer). `tierOf(item)` returns 'legendary' | 'epic' | 'rare' | 'common'.
- methods: `setPool(items, pick)` (pick() returns the committed winner, side-owned selection rules), `activate()`, `deactivate()`, `pull()`, `slamStop()`, `cancel()`, `destroy()`, `get state`.
- State machine: `inactive | idle | spinning | landing | revealing`. 
  - `pull()` only from idle. Winner is chosen ONCE by `pick()` before any motion and never rerolled.
  - A tap/click/Enter/Space on `hit` or the Pull button while `spinning` calls `slamStop()`: re-time the remaining rotation to the same committed end angle over ~450 ms ease-out, ticks keep firing, exactly one landing. Taps during landing/revealing are ignored.
  - Ignore keyboard auto-repeat (`e.repeat`). Do not bind Space globally (only on the focused hit element / native buttons).
  - Every rAF, timeout and callback carries a generation token; `cancel()`, `deactivate()`, `setPool()`, `destroy()` bump it so nothing stale can fire `onLand`/`onReveal` or start playback. (Today K-pop can reveal after deactivate: `src/charts.js:222` vs `:406`. Fix that.)
- Motion (keep K-pop numbers exactly): 3 full turns + offset, 3600 ms, ease `1 - (1-p)^4`, tick sound when a card boundary passes, cards passing behind the ring get refilled with random pool items while p < 0.8 (so the ring feels like the whole deck), winner placed at the back slot at start. Idle drift ~7 deg/s when idle (not in reduced motion or Lite mode: use `isLite()` from `src/fx.js`).
- Honest anticipation: when the remaining angle to the landing angle is < 1.5 card steps, add class `incoming` + `data-tier` to the winner slot (CSS glows its edge in tier colour). No fake near-misses.
- Landing: lift the winning card (translateZ + scale like K-pop), then `onLand(item, tier)`; tier-scaled celebration done by the machine:
  - legendary: big confetti, new `sound.clack()` then `sound.fanfare('legendary')` (an octave up), `navigator.vibrate?.([30, 40, 70])`
  - epic: confetti, fanfare, vibrate 25
  - rare: small confetti, fanfare, vibrate 15
  - common: no confetti, new `sound.chime()`, vibrate 10
  - Vibrate only if available and not reduced motion. Then hold 1300 ms (500 reduced motion) and call `onReveal(item)`.
- Reduced motion (`prefers-reduced-motion`): turns = 0, duration 350 ms, no idle drift, no glow animation.
- Resize: re-layout radius/slot positions without restarting a spin.

## `src/sound.js`
Add `clack()` (short low percussive hit) and `chime()` (one soft bell, ~300 ms). `fanfare(tier)`: existing sound by default; `'legendary'` an octave up. Existing callers must sound identical.

## K-pop side (`src/charts.js`, `index.html`, `styles.css`)
Charts keeps data, list/range, `#pick()` selection, crowd, accent colour, stamp text, collection, `quick()`, `reveal()`. It delegates ring building, idle spin and pull animation to PullMachine (`#ringBtn` = hit, `#pullBtn` = button). Visible behaviour and timing identical to today, plus: slam-stop, Stop label while spinning, incoming glow, tier-scaled celebration. Remove now-dead ring code from charts.js.

## Pop side (`pop/src/app.js`, `pop/index.html`, `pop/styles.css`)
- Remove the CSS `spinRing` animation and the per-card click handlers (`slotFor` button click). Add a hit element over the ring like K-pop's `#ringBtn`. `#pull` is the Pull button.
- Selection stays Pop's: pick from `TOP` honouring the existing `shown` set (do not repeat recently shown songs); keep `G.songRarity(o)` for tier (map its id to the four tiers).
- On reveal: today's `playTop(song, true, isNew)` (stamp `#N Rarity · New`, big card, play). Chart rows below keep direct play (`playTop(s, false)`), and clicking a row while a pull is spinning cancels the pull first.
- Sound: Pop has none today. Create one `Sound` from `../../src/sound.js` with a mute toggle button next to Pull, persisted in localStorage key `encore.sound` ('on' default). Call `sound.unlock()` on the first pull.
- Ring slot count keeps today's 10 (< 520 px wide) / 12; machine must handle crossing the 520 px breakpoint mid-idle (rebuild) and mid-spin (finish, then rebuild).
- Pop's visual style stays Pop's (its colours, card renderer `makeCard`/`songModel` from `pop/src/cards.js`); only the motion/feel is shared.

## CSS
Shared rules for `.incoming` glow and lift can live in each side's stylesheet (no new stylesheet link needed), using tier colours each side already has. Keep phones fine at 375 px: ring and hit area must not block vertical page scrolling (use `touch-action: manipulation` on the hit area, no preventDefault on touchmove).

## Don't
- Don't touch Roulette modes, the Auto menu, data files, scripts, READMEs, `anime/`.
- No new dependencies. No build step.

## Done when
1. `npm test` in the repo root passes and `node --test` inside `pop/` passes (run both).
2. `node --check` passes on every changed .js file.
3. A short self-review: grep that `spinRing` is gone from pop, that `charts.js` no longer has its own pull animation loop, that every `onLand`/`onReveal` call is guarded by the generation token.

## Return
Max 30 lines: files changed with one line each, test output lines (pass counts), anything you could not do or decided differently and why.
