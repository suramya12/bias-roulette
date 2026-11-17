# Bias Roulette: Anime

The third side: anime openings, endings and insert songs, plus animated music videos (KPop Demon Hunters, K/DA, Linkin Park…) behind an on/off switch. The unit is always the song, never the show. The design is in [`DESIGN.md`](DESIGN.md); build briefs are in [`briefs/`](briefs/).

## The page

Open `/anime/` after `npm start`. Pull a song from the ring; use OP, ED and Insert chips or the small **+ Animated MVs** switch to filter. **Auto** chains songs, and **⇄ Version** switches copies from the start. Failed copies fall through to a backup; after three failed songs in a row, Auto pauses with **Resume**. The browser remembers filters, Auto, sound, preferred copies and local copy strikes.

## Add songs

Append one line per song to a seed list. Nothing else needs editing.

- `data/seeds/themes.txt`: `Artist | Song | Show | OP|ED|IN | year [| aka Other name; Another]`
- `data/seeds/animated-mv.txt`: `Artist | Song | Source | MV | year [| aka …]`

`aka` names make search work for what people actually call a song (FLOW's "GO!!!" is "Fighting Dreamers" to most fans).

A new group of extras (say game music videos) = one line in `data/kinds.json` plus its own seed file. Its on/off switch will appear on the page by itself.

## Find videos

```bash
npm run anime:resolve
```

Only new or changed lines are searched (`-- --refresh` re-searches all, `-- --only "text"` one song). It reads YouTube's own pages, about one request every 2.5 s, and backs off when YouTube pushes back. Pages are cached in `anime/.cache/` (not committed).

Each song keeps up to **4 copies**, best first: official creditless, official TV cut, official MV, then fan uploads. Every copy must:

- pass the junk filter (no AMVs, covers, nightcore, sped-up, lyric, "1 hour" versions…);
- be allowed to play on other sites;
- be **HD** (720p or better, read from the video's own format list).

A fan upload also needs **1M+ views or 3+ years online**. "Official" means the channel is listed in `data/channels.json` → `trusted` (reviewed by hand); `blocked` channels (cover bands, re-uploaders) are never used.

Results: `data/catalog.json` (what the page reads) and `REVIEW.md` (problems first). Manual picks go in `data/overrides.json` (`"Artist | Song": "VIDEO_ID"`, or `null` to drop a song); scripts never write it.

## Keep it healthy

```bash
npm run anime:health
```

Re-checks every stored copy and logs it in `data/health.json`:

- **Booted at once**: video removed, private, account closed, or embedding switched off.
- **Strikes**: other failures count 1 per check; **3 strikes in total** (not in a row) and the copy is booted.
- Our own network or throttling problems never count, and region blocks never ban a video for everyone.
- Booted videos are never picked again. Songs below 4 copies get refilled; a song with none is set aside in `REVIEW.md` (its seed line stays, so a later run can try again).

## First test (2026-11-17)

40 songs (32 anime themes from 1981 to 2023, 8 animated MVs): **39 playable**, 29 with all 4 HD copies. Set aside: "God knows..." (no HD copy that passes the rules).
