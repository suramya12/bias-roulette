// Big screens: zoom the whole page so it fills the display (laid out for about 1200x720).
// --z lets the CSS undo the zoom on viewport units, which would otherwise grow with it.
(function () {
  function fit() {
    var z = Math.min(innerWidth / 1200, innerHeight / 720, 3);
    z = z > 1.05 ? Math.round(z * 100) / 100 : 1;
    var s = document.documentElement.style;
    s.zoom = z === 1 ? '' : String(z);
    s.setProperty('--z', String(z));
  }
  fit();
  addEventListener('resize', fit);
})();
