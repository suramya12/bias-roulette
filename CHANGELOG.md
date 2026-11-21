# Changelog

## 1.1.1 (2026-11-21)

### Data
- K-pop: songs outside the streaming chart now show their real MV view count instead of "—" (about 1,100 songs, from kworb.net with YouTube as a fallback). Refresh with `npm run kpop:views`, then `npm run data:kpop`.
- K-pop: songs outside the chart are ranked by MV views, so rarer cards are the less-watched songs.
- K-pop: seven songs played the wrong video and now play the official one: g.o.d "Road" (was Lil Nas X), D.O. "Sing Along!" and "Popcorn" (were other artists' songs), KARA "Mister" (was another group's song), JOY "Je T'aime" (was the original singer's version), Whee In "In The Mood" (was a reaction video) and LISA "MONEY" (was a fan upload).

## 1.1.0 (2026-11-21)

Polish release from the cross-edition UI/UX audit.

### Consistency
- One set of deck rules (`pop/src/deck.js`) now feeds the hub, the wheel, the Collection and the Passport, so their counts agree (K-pop: 170 idols, Pop & Latin: 164 artists, Anime: 250 titles, Bollywood: 100 stars).
- The Collection lists only cards you can actually win. Songs that Roulette can award are no longer missing from it.
- Menus and the Collection use each edition's own colours (no K-pop purple in Bollywood or Anime).
- Anime calls its wheel entries "titles" and labels animated MVs as such. Bollywood copy uses "their songs".
- Anime gets the crowd particles the other editions have.

### Roulette
- The wheel shows 24 readable slices at a time while still drawing from the whole deck.
- Wheel ticks, a chime for the round-one winner and a fanfare for the song, controlled by the header Sound button (now shared by both modes).
- The song reveal keeps "Drawn for …" so the round-one winner stays visible.
- Song cards with no stream or view data show "—" instead of an empty block.
- Stat labels wrap instead of truncating ("SOLO SON…").
- The Auto menu opens below its button and no longer covers the finalists.
- The result scrolls in under the header instead of behind it.

### Collection
- Search, a "Collected only" filter and a friendly empty state.
- A clearly labelled Close button, one scrollbar (the page behind is locked).

### Loading and navigation
- Opening `#top100` shows Top 100 and your saved card count right away (no Roulette / 0 flash).
- Space is held for the game while data loads, so the footer does not jump.
- Switching modes scrolls back to the top.
- Chart thumbnails shimmer while loading; the chart explains that only pulls add cards.
- The home link sits at the top left.

### Hub
- Bollywood's card copy matches the others; card titles have a shadow for contrast.
- The ✦ counter is labelled "stardust".

### Data
- K-pop: SEJEONG "Flower Way" now plays her own MV (it played a different artist's song of the same name).
