import test from 'node:test';
import assert from 'node:assert/strict';
import { watchMetadata } from '../scripts/lib.mjs';

const page = (micro) => `<script>var ytInitialPlayerResponse = ${JSON.stringify({
  playabilityStatus: { status: 'OK', playableInEmbed: true },
  videoDetails: { videoId: 'abcdefghijk', title: 't', author: 'a', channelId: 'c', lengthSeconds: '90', viewCount: '5713302' },
  microformat: { playerMicroformatRenderer: micro },
})};</script>`;

test('publish date accepts full timestamps (current YouTube format)', () => {
  const m = watchMetadata(page({ publishDate: '2006-09-25T14:53:27-07:00' }), '2026-11-17');
  assert.equal(m.published, '2006-09-25');
  assert.equal(m.views, 5713302);
});

test('publish date falls back to uploadDate and still accepts plain dates', () => {
  assert.equal(watchMetadata(page({ uploadDate: '2019-01-02T00:00:00Z' }), 'x').published, '2019-01-02');
  assert.equal(watchMetadata(page({ publishDate: '2020-05-06' }), 'x').published, '2020-05-06');
});
