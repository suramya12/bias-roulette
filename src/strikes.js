export function createStrikes(limit = 3) {
  let count = 0;
  return {
    fail() { return ++count >= limit; },
    ok() { count = 0; },
    get out() { return count >= limit; },
  };
}
