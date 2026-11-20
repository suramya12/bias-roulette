// Cross-side passport: tracks collection counts, owned song video ids, dust,
// daily drop seals, streaks, world tour bonuses, and set completion.
// Stored in localStorage under 'bias-roulette.passport.v1'; falls back to
// in-memory state for the visit if storage is blocked.

export const STORE = 'bias-roulette.passport.v1';
export const SIDES = Object.freeze(['kpop', 'pop', 'anime', 'bollywood']);
export const DUST_BY_TIER = Object.freeze({ common: 5, rare: 10, epic: 20, legendary: 40 });
export const TOUR_BONUS = 50;
export const SET_BONUS = 150;
export const UNSEEN_COST = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDateStr = (v) => typeof v === 'string' && DATE_RE.test(v);
const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const isSide = (s) => SIDES.includes(s);

/** Visitor's local calendar day as YYYY-MM-DD. */
export function localDate(date = new Date()) {
  if (isDateStr(date)) return date;
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar day immediately before YYYY-MM-DD. */
export function prevDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d - 1));
}

/** Whole hours remaining until local midnight (at least 1). */
export function hoursUntilMidnight(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.max(1, Math.ceil((midnight - d) / 3_600_000));
}

/** Map any side's tier id (or tier object) onto common | rare | epic | legendary. */
export function normalizeTier(tier) {
  const raw = typeof tier === 'object' && tier !== null ? tier.id : tier;
  const key = String(raw || '').toLowerCase();
  if (key === 'legend' || key === 'legendary') return 'legendary';
  if (key === 'epic') return 'epic';
  if (key === 'rare') return 'rare';
  return 'common';
}

/** 32-bit FNV-1a hash. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function cleanIdList(list, maxLen = 64) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item || item.length > maxLen || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Normalize raw parsed storage into a safe state object. Never throws. */
export function normalizeState(saved) {
  const src = isObj(saved) ? saved : Object.create(null);

  const owned = Object.create(null);
  const total = Object.create(null);
  const ids = Object.create(null);
  const rawOwned = Object.hasOwn(src, 'owned') && isObj(src.owned) ? src.owned : null;
  const rawTotal = Object.hasOwn(src, 'total') && isObj(src.total) ? src.total : null;
  const rawIds = Object.hasOwn(src, 'ids') && isObj(src.ids) ? src.ids : null;

  for (const side of SIDES) {
    owned[side] = rawOwned && Object.hasOwn(rawOwned, side) ? nonNegInt(rawOwned[side]) : 0;
    total[side] = rawTotal && Object.hasOwn(rawTotal, side) ? nonNegInt(rawTotal[side]) : 0;
    ids[side] = rawIds && Object.hasOwn(rawIds, side) ? cleanIdList(rawIds[side]) : [];
  }

  const rawStreak = Object.hasOwn(src, 'streak') && isObj(src.streak) ? src.streak : null;
  const count = rawStreak && Object.hasOwn(rawStreak, 'count') ? nonNegInt(rawStreak.count) : 0;
  const best = Math.max(count, rawStreak && Object.hasOwn(rawStreak, 'best') ? nonNegInt(rawStreak.best) : 0);
  const last = rawStreak && Object.hasOwn(rawStreak, 'last') && isDateStr(rawStreak.last) ? rawStreak.last : null;

  const rawDay = Object.hasOwn(src, 'day') && isObj(src.day) ? src.day : null;
  const dayDate = rawDay && Object.hasOwn(rawDay, 'date') && isDateStr(rawDay.date) ? rawDay.date : null;
  const sealed = Object.create(null);
  const rawSealed = rawDay && Object.hasOwn(rawDay, 'sealed') && isObj(rawDay.sealed) ? rawDay.sealed : null;
  if (dayDate && rawSealed) {
    for (const side of SIDES) {
      if (Object.hasOwn(rawSealed, side) && rawSealed[side] === true) sealed[side] = true;
    }
  }

  const tour = Object.hasOwn(src, 'tour') && isDateStr(src.tour) ? src.tour : null;
  const dust = Object.hasOwn(src, 'dust') ? nonNegInt(src.dust) : 0;
  const completedSets = Object.hasOwn(src, 'completedSets') ? cleanIdList(src.completedSets, 80) : [];
  const recent = [];
  if (Object.hasOwn(src, 'recent') && Array.isArray(src.recent)) {
    const seen = new Set();
    for (const item of src.recent) {
      if (!isObj(item) || !isSide(item.side) || typeof item.id !== 'string' || !item.id || item.id.length > 64) continue;
      const key = `${item.side}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push({ side: item.side, id: item.id });
      if (recent.length >= 6) break;
    }
  }

  return {
    owned,
    total,
    ids,
    dust,
    streak: { count, best, last },
    day: { date: dayDate, sealed },
    tour,
    completedSets,
    recent,
  };
}

let memoryState = null;
let unsaved = false;

function readState() {
  if (!unsaved) {
    try {
      const raw = localStorage.getItem(STORE);
      memoryState = normalizeState(raw ? JSON.parse(raw) : null);
      return memoryState;
    } catch { /* storage blocked or invalid JSON; fall back to in-memory state */ }
  }
  if (!memoryState) memoryState = normalizeState(null);
  return memoryState;
}

function writeState(state) {
  memoryState = state;
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
    unsaved = false;
  } catch {
    unsaved = true;
  }
}

/** Update a side's reported owned/total card counts and owned song video ids. */
export function report(side, { owned, total, ids } = {}) {
  if (!isSide(side)) return summary();
  const state = readState();
  if (Number.isInteger(owned) && owned >= 0) state.owned[side] = owned;
  if (Number.isInteger(total) && total >= 0) state.total[side] = total;
  if (Array.isArray(ids)) {
    const prev = new Set(state.ids[side]);
    const next = cleanIdList(ids);
    for (const id of next) {
      if (!prev.has(id)) {
        state.recent = [{ side, id }, ...state.recent.filter((r) => !(r.side === side && r.id === id))].slice(0, 6);
      }
    }
    state.ids[side] = next;
  }
  writeState(state);
  return summary();
}

/** Record a collected card; duplicates grant dust by tier. Returns dust gained. */
export function collected(side, { isNew = false, tier = 'common' } = {}) {
  if (!isSide(side) || isNew) return 0;
  const gain = DUST_BY_TIER[normalizeTier(tier)] ?? DUST_BY_TIER.common;
  const state = readState();
  state.dust += gain;
  writeState(state);
  return gain;
}

/** Today's deterministic featured id for a side from a stable sorted list. */
export function dailyPick(side, ids, date = new Date()) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const sorted = [...ids].sort();
  const key = `${localDate(date)}:${side}`;
  return sorted[fnv1a(key) % sorted.length];
}

/** Seal today's drop for a side, update streak, and award the world-tour bonus once per day. */
export function claim(side, date = new Date()) {
  if (!isSide(side)) return { claimed: false, tour: false, dust: 0 };
  const today = localDate(date);
  const state = readState();

  if (state.day.date !== today) {
    state.day = { date: today, sealed: Object.create(null) };
  }
  if (state.day.sealed[side] === true) {
    return { claimed: false, tour: false, dust: 0 };
  }

  state.day.sealed[side] = true;

  if (state.streak.last === today) {
    // Already counted today from another side.
  } else if (state.streak.last === prevDate(today)) {
    state.streak.count += 1;
    state.streak.last = today;
  } else {
    state.streak.count = 1;
    state.streak.last = today;
  }
  if (state.streak.count > state.streak.best) state.streak.best = state.streak.count;

  let tour = false;
  let dust = 0;
  if (SIDES.every((s) => state.day.sealed[s] === true) && state.tour !== today) {
    state.tour = today;
    state.dust += TOUR_BONUS;
    tour = true;
    dust = TOUR_BONUS;
  }

  writeState(state);
  return { claimed: true, tour, dust };
}

/** Spend n dust if available. Returns true if spent. */
export function spend(n) {
  if (!Number.isInteger(n) || n < 0) return false;
  if (n === 0) return true;
  const state = readState();
  if (state.dust < n) return false;
  state.dust -= n;
  writeState(state);
  return true;
}

/** True if today's drop for `side` has already been sealed. */
export function isClaimedToday(side, date = new Date()) {
  if (!isSide(side)) return false;
  const today = localDate(date);
  const state = readState();
  return state.day.date === today && state.day.sealed[side] === true;
}

/** Check sets against owned song video ids; award +150 dust for each newly completed set. */
export function checkSets(sets) {
  if (!Array.isArray(sets) || !sets.length) return { completed: [], dust: 0 };
  const state = readState();
  const ownedBySide = Object.create(null);
  for (const side of SIDES) ownedBySide[side] = new Set(state.ids[side]);
  const done = new Set(state.completedSets);
  const completed = [];

  for (const set of sets) {
    if (!set?.id || !Array.isArray(set.items) || !set.items.length || done.has(set.id)) continue;
    const allOwned = set.items.every((item) => isSide(item?.side) && ownedBySide[item.side].has(item.id));
    if (allOwned) {
      done.add(set.id);
      state.completedSets.push(set.id);
      state.dust += SET_BONUS;
      completed.push(set);
    }
  }

  if (completed.length) writeState(state);
  return { completed, dust: completed.length * SET_BONUS };
}

/** Compute per-set progress sorted nearly-complete first (completed sets last). */
export function setProgress(sets) {
  if (!Array.isArray(sets) || !sets.length) return [];
  const state = readState();
  const ownedBySide = Object.create(null);
  for (const side of SIDES) ownedBySide[side] = new Set(state.ids[side]);
  const done = new Set(state.completedSets);

  return sets.map((set, index) => {
    const items = (set.items || []).map((item) => ({
      side: item.side,
      id: item.id,
      owned: isSide(item.side) && ownedBySide[item.side].has(item.id),
    }));
    const ownedCount = items.filter((item) => item.owned).length;
    const totalCount = items.length;
    const complete = done.has(set.id) || (totalCount > 0 && ownedCount === totalCount);
    const ratio = totalCount > 0 ? ownedCount / totalCount : 0;
    return { ...set, items, ownedCount, totalCount, complete, ratio, _index: index };
  }).sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    if (b.ownedCount !== a.ownedCount) return b.ownedCount - a.ownedCount;
    return a._index - b._index;
  }).map(({ _index, ...rest }) => rest);
}

let setsPromise = null;
/** Fetch and cache data/sets.json. Resolves to [] if unavailable. */
export function loadSets() {
  return (setsPromise ??= fetch(new URL('../data/sets.json', import.meta.url), { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error('sets'); return r.json(); })
    .then((data) => (Array.isArray(data?.sets) ? data.sets : []))
    .catch(() => { setsPromise = null; return []; }));
}

/** Snapshot of everything the landing page, passport sheet, and share card need. */
export function summary(date = new Date()) {
  const today = localDate(date);
  const yesterday = prevDate(today);
  const state = readState();

  const owned = Object.create(null);
  const total = Object.create(null);
  const ids = Object.create(null);
  const sealed = Object.create(null);
  let totalOwned = 0;
  let totalCards = 0;
  let anySealed = false;

  for (const side of SIDES) {
    owned[side] = state.owned[side];
    total[side] = state.total[side];
    ids[side] = [...state.ids[side]];
    totalOwned += owned[side];
    totalCards += total[side];
    const isSealed = state.day.date === today && state.day.sealed[side] === true;
    sealed[side] = isSealed;
    if (isSealed) anySealed = true;
  }

  const streakAlive = state.streak.last === today || state.streak.last === yesterday;
  const activeCount = streakAlive ? state.streak.count : 0;
  const hasProfile = totalOwned > 0 || state.dust > 0 || state.streak.best > 0 || anySealed || state.completedSets.length > 0;

  return {
    sides: SIDES,
    owned,
    total,
    ids,
    totalOwned,
    totalCards,
    dust: state.dust,
    streak: {
      count: activeCount,
      best: state.streak.best,
      last: state.streak.last,
    },
    day: { date: today, sealed },
    tour: state.tour,
    tourComplete: state.tour === today,
    completedSets: [...state.completedSets],
    recent: state.recent.map((r) => ({ side: r.side, id: r.id })),
    hasProfile,
  };
}
