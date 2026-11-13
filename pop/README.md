# Bias Roulette: Pop & Latin

The English-language and Latin pop side of Bias Roulette. It lives in `pop/`; the K-pop side is the site root. The genre menu at the top left of either page switches between them and keeps you in the same mode (Roulette or Top 100). No build step, no dependencies.

- **Roulette**: the same rules as the K-pop side. Every artist in the deck is on the wheel: spin to draw 5 finalists, then the wheel holds only those 5 and the first to 3 hits wins. That artist's songs go on the wheel for another draw and showdown, and the winning song's official MV plays in the page. **Choose for me** plays the remaining spins quickly. Two decks, picked with the chip under the header:
  - **All**: the 138 biggest English and Latin acts (`ROSTER` in `scripts/roster.mjs`).
  - **Favourites**: a curated 100 on a gold wheel (the `BIAS` list, in its own order). Fifth Harmony counts as a group; members who also had a band (Gwen Stefani, Nicole Scherzinger, Cheryl, Andrea Corr, Anahí, Mette Lindberg, Gloria Estefan) get their band's songs on their wheel too.
- **Top 100**: a ring of face-down photocards on a concert stage. Pull one and its MV plays. The full ranked chart sits below the stage; tap a row to play it.

Every artist and song you win is saved in your browser (localStorage) and shown in the **Binder**.

Links: `pop/#roulette`, `pop/#roulette/favs`, `pop/#top100`. With no hash the page opens the deck you used last.

## Run it

Needs Node 18 or newer.

From the repository root (it serves both sides):

```bash
npm start
```

Open http://localhost:5173/pop/. The server also prints a `Network:` address you can open on a phone on the same Wi-Fi.

Run the tests and data scripts from inside `pop/`:

```bash
node --test
```

## Rebuild the data

```bash
node scripts/chart.mjs
node scripts/portraits.mjs
```

Then check the result:

```bash
node scripts/audit.mjs
```

It fails if a video is used for two songs, two cards share art, a soloist has band songs, a wheel repeats a song, a Top 100 rank is missing, or a bias artist has no songs.

Downloaded pages are cached in `.cache/` (gitignored). Add `--fresh` to either script to download everything again.

- `scripts/roster.mjs`: the artist list, bands, the `BIAS` list, `EXCLUDE` and `EXTRA_VIDEOS`. `ROSTER` is the Artist Roulette wheel; `BIAS_EXTRA` adds the bias artists who are not on it. An act outside kworb's top-3000 list needs its Spotify artist id pinned with `spid`.
- Acts with no kworb Spotify page at all (Esmée Denters, Hayden Panettiere, Diana Vickers, The Asteroids Galaxy Tour) get their songs from their official MVs on YouTube. Their stream count shows as `—` and their score is views / 2.
- Adding artists can change the Top 100: every scored song competes for the same overall ranks.
- `scripts/chart.mjs`: Spotify totals per artist from kworb.net (`/spotify/artist/<id>_songs.html`), YouTube views from kworb.net (`/youtube/artist/<slug>.html` and the all-time top videos list). Songs kworb has no MV for, with 300M+ streams, fall back to a YouTube search. Writes `data/data.json`.
- `scripts/portraits.mjs`: picks a Wikimedia Commons photo for each artist. Writes `data/portraits.json`.

### Matching rules

- **Official MV only.** Audio, lyric, visualizer, teaser, dance practice, live, fan, reaction, 8D and similar uploads are rejected. So are TV specials, award shows, "sessions", TikTok edits, stripped/acoustic versions, and remix videos (unless the song itself is the remix). YouTube search results must come from the artist's own channel (never a fan channel) and have at least 1 view per 500 streams.
- **Featured only?** An MV titled `Other Artist - Song ft. This Artist` is not credited to the featured artist.
- The **quoted title** decides the match (`Artist 'Song' Official MV`). Without quotes the title is split on `-`, `|` and `:`, and a part that is only an artist's name is ignored.
- `(feat. …)`, `(with …)`, `- From "…"`, `(Taylor's Version)` and remaster tags are stripped. Curly quotes and accents are normalised. Native-script titles with an English name in brackets match on the English name.
- **Lead credit only.** Rows kworb marks as features (`*`) never count for that artist. A duet listed under both artists is credited to whoever comes first in the MV title.

### Fix a wrong or missing video

The chart script ends with a list of big songs it could not match. Add an entry to `EXTRA_VIDEOS` in `scripts/roster.mjs`:

```js
export const EXTRA_VIDEOS = {
  'Artist Name|songkey': 'YouTubeId11',
};
```

The key is the printed `Artist|key`. To drop a song entirely, add the same key to `EXCLUDE`. To stop one wrong video from being picked (a live clip, a TV special), add its id to `BAD_VIDEOS`; the matcher then takes the next best video or leaves the song out. Then run `node scripts/chart.mjs` again.

### Fix a wrong photo

Add the exact Commons file name to `FILE` at the top of `scripts/portraits.mjs`, or change the pinned Wikipedia article in `roster.mjs`. Artists with no usable Commons photo get a frame from an MV they lead, and no two artists share a picture.

## Scores and rarity

- **Score** = (Spotify streams across all versions + official MV views) / 2.
- **Overall rank** is a song's position among every scored song. It is the card's rank everywhere: chart, ring, wheel and binder.
- **Song rarity**: Legendary #1–10, Epic #11–30, Rare #31–100, Common outside the Top 100.
- **Artist Power** (1–10) ranks artists by solo-song score plus a third of band-song score (groups count their own songs fully). Each step is a tenth of all artists, so Power 10 is the top 10%. Power 9–10 is Legendary, 7–8 Epic, 5–6 Rare, the rest Common.
- Artist stat stones show band songs and solo songs. A soloist shows 0 / N.

## Pictures

No AI-generated likenesses. Artist cards use freely licensed photos from Wikimedia Commons, credited under the big card with photographer and licence. Song cards use the song's own YouTube MV thumbnail.

## Deploy

All paths are relative, so the site works under a sub-path. It is published with the rest of the repository (see the root README).

## Credits

Fan project, not affiliated with any artist or label. Stream and view counts come from kworb.net. Videos are YouTube embeds. Artist photos are from Wikimedia Commons under their own licences (mostly CC BY / CC BY-SA). Every photo is credited on the page: under the big card, and in the **Photo credits** list in the footer.
