import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const marker = '<script data-rudder-app></script>';
const template = await readFile(
  join(pluginRoot, 'ui', 'rudder-app.html'),
  'utf8'
);
const result = await build({
  entryPoints: [join(pluginRoot, 'ui', 'rudder-app.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  platform: 'browser',
  target: 'es2022',
  write: false,
});
const output = result.outputFiles?.[0];

if (!output || !template.includes(marker)) {
  throw new Error('Could not build the Rudder MCP App resource');
}

const script = output.text
  .replaceAll('</script', '<\\/script')
  .replaceAll('<!--', '<\\!--');
const html = template.replace(
  marker,
  `<script data-rudder-app>${script}</script>`
);

await writeFile(join(pluginRoot, 'dist', 'rudder-app.html'), html);
