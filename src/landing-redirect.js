function redirectToKpop() {
  if (/^#(?:roulette|top100|binder)(?:\/|$)/.test(location.hash) || new URLSearchParams(location.search).has('forceVideo')) {
    location.replace(new URL('kpop/' + location.search + location.hash, location.href));
  }
}
redirectToKpop();
addEventListener('hashchange', redirectToKpop);
