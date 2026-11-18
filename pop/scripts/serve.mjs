// Serve Pop at its normal path so it can use the shared runtime modules.
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../../scripts/static-server.mjs';

const PUBLIC = ['pop/index.html', 'pop/styles.css', 'pop/src/', 'pop/data/', 'favicon.svg',
  'src/display-scale.js', 'src/pull-machine.js', 'src/game.js', 'src/fx.js', 'src/sound.js',
  'src/auto-advance.js', 'src/strikes.js', 'src/youtube-api.js', 'src/validation.js'];

await serveStatic({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  port: Number(process.argv.slice(2).find((arg) => arg !== '--lan')) || Number(process.env.PORT) || 5173,
  publicPaths: PUBLIC,
  redirects: new Map([['/', '/pop/'], ['/pop', '/pop/']]),
  name: 'Encore Cards',
  home: '/pop/',
});
