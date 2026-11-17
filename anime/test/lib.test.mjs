import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import {
  parseSeedLine, songKey, extractInitialData, videosFromSearch, playability,
  classify, score, trustLevel, knownNames,
} from '../scripts/lib.mjs';

const fixture = name => readFile(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
const seed = parseSeedLine('TK from Ling tosite sigure | unravel | Tokyo Ghoul | OP | 2014 | aka Unravel; Unravel');
const video = { id: 'abcdefghijk', title: 'unravel opening', channel: 'Crunchyroll', channelId: 'trusted', seconds: 90, views: 10 };
const channels = { trusted: { trusted: 'Reviewed channel' }, blocked: {}, knownNames };

test('seed fields, aliases, comments, and extensible registry kinds', () => {
  assert.equal(seed.show, 'Tokyo Ghoul');
  assert.equal(seed.year, 2014);
  assert.deepEqual(seed.aliases, ['Unravel']);
  assert.equal(parseSeedLine(' # comment'), null);
  assert.equal(parseSeedLine(' '), null);
  const mv = parseSeedLine('K/DA | POP/STARS | League of Legends | MV | 2018', 'animated-mv');
  assert.equal(mv.source, 'League of Legends');
  assert.equal(mv.kind, 'animated-mv');
  assert.equal(parseSeedLine('A | B | C | MV | 2000', 'game-mv').kind, 'game-mv');
  for (const bad of ['A | B', 'A | B | C | OP | year', 'A | B | C | MV | 2000', 'A | B | C | OP | 2000 | bad', '| B | C | OP | 2000']) {
    assert.throws(() => parseSeedLine(bad), /Invalid seed line/);
  }
});

test('stable keys strip accents, collapse punctuation, and preserve artist/title boundary', () => {
  assert.equal(songKey(' BÔA ', 'Duvet!!!'), songKey('boa', 'duvet'));
  assert.equal(songKey('A—B', 'C & D'), songKey('a b', 'c d'));
  assert.notEqual(songKey('A B', 'C'), songKey('A', 'B C'));
  assert.notEqual(songKey('歌手', '歌'), songKey('別の歌手', '歌'));
  assert.equal(songKey(seed), seed.id);
});

test('balanced JSON extraction handles escaped quotes, braces, window assignments, and trailing scripts', () => {
  const data = { title: 'quote " } { \\ end', nested: { items: [1, 2] } };
  const html = `<script>window["ytInitialData"] = ${JSON.stringify(data)};</script><script>{junk}</script>`;
  assert.deepEqual(extractInitialData(html), data);
  assert.throws(() => extractInitialData('<html>consent</html>'), /Missing or malformed/);
  assert.throws(() => extractInitialData('var ytInitialData = {invalid};'), /Missing or malformed/);
});

test('real search fixture extracts metadata, verified and official artist badges', async () => {
  const videos = videosFromSearch(extractInitialData(await fixture('search-unravel')));
  assert.equal(videos.length, 19);
  assert.deepEqual(videos[0], {
    id: 'gjD_x4222Q8', title: 'Tokyo Ghoul Opening 1 (4k 60FPS)┃Creditless',
    channel: 'KaizenK', channelId: 'UChi9H_-PaOFwgxqvSEpm5Gg', verified: false,
    officialArtist: false, seconds: 107, views: 603564,
  });
  assert.equal(videos.find(v => v.id === '7aMOurgDB-o').verified, true);
  assert.equal(videos.find(v => v.id === 'Fve_lHIPa-I').officialArtist, true);
});

test('search traversal deduplicates IDs and tolerates sparse renderers', () => {
  const renderer = { videoRenderer: { videoId: 'abcdefghijk', title: { simpleText: 'Song' }, shortViewCountText: { simpleText: '1.2M' } } };
  const videos = videosFromSearch({ items: [renderer, { nested: renderer }, { videoRenderer: {} }] });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].views, 1200000);
  assert.equal(videos[0].seconds, 0);
  assert.equal(videos[0].channelId, '');
});

test('playability distinguishes missing embed evidence from explicit denial', async () => {
  assert.deepEqual(playability(await fixture('watch-ok')), { status: 'OK', embed: true, reason: '', parsed: true });
  assert.deepEqual(playability(await fixture('watch-blocked')), { status: 'LOGIN_REQUIRED', embed: null, reason: '', parsed: true });
  assert.deepEqual(playability('var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"}};'), { status: 'OK', embed: null, reason: '', parsed: true });
  assert.deepEqual(playability('<html>challenge</html>'), { status: 'UNKNOWN', embed: null, reason: 'Missing or malformed player response', parsed: false });
});

for (const term of ['AMV', 'cover', 'lyric', 'lyrics', 'nightcore', 'slowed', 'reverb', '1 hour', '10 hours', 'reaction', 'piano', 'guitar', 'drum', 'karaoke', 'instrumental', '8D', 'fanmade', 'fan made', 'edit', 'live', 'concert']) {
  test(`rejects ${term}`, () => {
    assert.ok(classify({ ...video, title: `${video.title} ${term}` }, seed, channels).reject);
  });
}

test('duration boundaries, live opt-in, unknown full versions, and accepted official full versions', () => {
  for (const seconds of [0, 44, 721, NaN]) assert.ok(classify({ ...video, seconds }, seed, channels).reject);
  for (const seconds of [45, 720]) assert.equal(classify({ ...video, title: 'unravel music video', seconds }, seed, channels).reject, undefined);
  const live = { ...video, title: 'unravel live music video' };
  assert.equal(classify(live, { ...seed, title: 'unravel live' }, channels).reject, undefined);
  const full = { ...video, title: 'unravel full version official video', channel: 'Unknown', channelId: 'unknown' };
  assert.equal(classify(full, seed, channels).reject, 'fan MV for a theme');
  assert.equal(classify({ ...full, verified: true }, seed, channels).reject, 'fan MV for a theme');
  assert.equal(classify({ ...full, channelId: 'trusted' }, seed, channels).reject, undefined);
});

test('all creditless markers, TV lengths, MV markers, and artist badges classify', () => {
  for (const marker of ['creditless', 'non-credit', 'NCOP', 'NCED', 'clean opening', 'clean ending', 'ノンクレジット']) {
    assert.equal(classify({ ...video, title: `unravel ${marker}` }, seed, channels).kind, 'creditless');
  }
  for (const marker of ['opening', 'ending', 'OP', 'ED', '主題歌']) {
    for (const seconds of [60, 150]) assert.equal(classify({ ...video, title: `unravel ${marker}`, seconds }, seed, channels).kind, 'tv');
  }
  for (const seconds of [59, 151]) assert.ok(classify({ ...video, seconds }, seed, channels).reject);
  for (const marker of ['music video', 'MV', 'official video']) assert.equal(classify({ ...video, title: `unravel ${marker}` }, seed, channels).kind, 'mv');
  assert.equal(classify({ ...video, title: 'unravel', officialArtist: true }, seed, channels).kind, 'mv');
  assert.equal(classify({ ...video, channel: 'Fan', channelId: 'fan' }, { ...seed, kind: 'animated-mv' }, channels).reject, 'not a music video');
  assert.equal(classify(video, { ...seed, kind: 'animated-mv' }, channels).kind, 'mv');
  assert.equal(classify({ ...video, title: 'unravel opening official video' }, { ...seed, kind: 'animated-mv' }, channels).kind, 'mv');
});

test('trust supports reviewed IDs, badges, artist and known names; blocklist and Topic win', () => {
  const unknown = { ...video, channel: 'Random person', channelId: 'unknown' };
  assert.equal(classify(unknown, seed, channels).reject, undefined);
  assert.equal(trustLevel(video, seed, channels), 4);
  assert.equal(trustLevel({ ...unknown, verified: true }, seed, channels), 3);
  assert.equal(trustLevel({ ...unknown, officialArtist: true }, seed, channels), 3);
  assert.equal(trustLevel({ ...unknown, channel: `${seed.artist} Official` }, seed, channels), 2);
  assert.equal(trustLevel({ ...unknown, channel: 'Aniplex USA Official' }, seed, channels), 1);
  assert.equal(trustLevel({ ...unknown, channel: 'NotAniplex' }, seed, channels), 0);
  assert.equal(trustLevel({ ...video, channel: 'Crunchyroll - Topic', verified: true }, seed, channels), 0);
  assert.equal(classify({ ...video, verified: true }, seed, { ...channels, blocked: { trusted: 'No' } }).reject, 'blocked channel');
});

test('score prefers creditless then TV then MV, then trust and views for equivalent matches', () => {
  const creditless = { ...video, title: 'unravel creditless', views: 0 };
  const tv = { ...video, title: 'unravel opening', views: 1e12 };
  const mv = { ...video, title: 'unravel music video', views: 1e12 };
  assert.ok(score(creditless, seed, channels) > score(tv, seed, channels));
  assert.ok(score(tv, seed, channels) > score(mv, seed, channels));
  const verified = { ...tv, channelId: 'other', verified: true };
  const named = { ...tv, channelId: 'other', channel: seed.artist };
  assert.ok(score({ ...tv, views: 0 }, seed, channels) > score(verified, seed, channels));
  assert.ok(score({ ...verified, views: 0 }, seed, channels) > score(named, seed, channels));
  assert.ok(score({ ...tv, views: 20 }, seed, channels) > score({ ...tv, views: 10 }, seed, channels));
  assert.equal(score({ ...video, title: 'unravel cover' }, seed, channels), -Infinity);
});

test('all three pruned fixtures remain under 60 KB', async () => {
  for (const name of ['search-unravel', 'watch-ok', 'watch-blocked']) {
    assert.ok((await stat(new URL(`fixtures/${name}.html`, import.meta.url))).size < 60_000);
  }
});

test('identity gate: real wrong-song copies from the 2026-11-17 run are rejected', async () => {
  const { sameSong } = await import('../scripts/lib.mjs');
  const go = parseSeedLine('FLOW | GO!!! | Naruto | OP | 2004 | aka Fighting Dreamers');
  const habit = parseSeedLine('Linkin Park | Breaking the Habit | Breaking the Habit (animated music video) | MV | 2004', 'animated-mv');
  const kigeki = parseSeedLine('Gen Hoshino | Kigeki | Spy x Family | ED | 2022 | aka Comedy; 喜劇');
  assert.equal(sameSong({ title: 'Naruto - Opening 4 | GO!!!' }, go), true);
  assert.equal(sameSong({ title: 'Naruto Shippuden Opening 6 | Sign by FLOW' }, go), false);
  assert.equal(sameSong({ title: 'GO!!! by someone else' }, go), false);
  assert.equal(sameSong({ title: 'Numb (Official Music Video) [4K UPGRADE] – Linkin Park' }, habit), false);
  assert.equal(sameSong({ title: 'Breaking the Habit (Official Music Video) [HD UPGRADE] – Linkin Park' }, habit), true);
  assert.equal(sameSong({ title: '星野源「喜劇」:『SPY×FAMILY』エンディング主題歌' }, kigeki), true);
  for (const title of ['Donald Trump sings Unravel (Tokyo Ghoul OP)', 'Scum\'s Wish Ending Full VALORANT MONTAGE JETT',
    'Fullmetal Alchemist: Brotherhood All Openings 1-5', 'Daft Punk - Something About Us (Official Audio)',
    '【MAD】New Danganronpa V3 x Kekkai Sensen Ending', 'Gurren Lagann Opening 1 English by Sapphire HD creditless'])
    assert.ok(classify({ ...video, title }, seed, channels).reject, title);
});

test('fan re-edits, covers and crossovers from the second run are rejected', () => {
  const sorairo = parseSeedLine('Shoko Nakagawa | Sorairo Days | Gurren Lagann | OP | 2007 | aka 空色デイズ');
  for (const title of ['Avatar The Last Airbender - Anime Opening (Book 1) | "Sorairo Days" - (Gurren Lagann)',
    '【 8Bit / Chiptune 】Gurren Lagann Opening / "Sorairo Days"', 'Gurren Lagann OPENING HOMURA VER. (Sorairo Days)',
    'Gurren Lagann x Genshin Anime Opening "Sorairo Days"', 'Sorairo Days (English) - Gurren Lagann OP',
    'Gurren Lagann OP lofi Sorairo Days', 'Sorairo Days Gurren Lagann OP Cosplay', 'Gurren Lagann OP マイクラ再現 Sorairo Days'])
    assert.ok(classify({ ...video, title }, sorairo, channels).reject, title);
  for (const title of ['Gurren Lagann Opening 1 - Sorairo Days | Creditless | English / Romaji Subtitle',
    'Gurren Lagann OP (TV Size) Sorairo Days', 'Gurren Lagann Opening 1920x1080 Sorairo Days'])
    assert.equal(classify({ ...video, title }, sorairo, channels).reject, undefined, title);
});
