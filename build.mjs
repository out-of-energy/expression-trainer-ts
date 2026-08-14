import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DIST = 'dist';

await rm(DIST, { recursive: true, force: true });
await mkdir(`${DIST}/renderer`, { recursive: true });

// ---- 主进程（CommonJS，运行在 Node/Electron 环境）----
await build({
  entryPoints: ['src/main/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: `${DIST}/main.js`,
  external: ['electron', 'sherpa-onnx-node'],
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});

// ---- 预加载脚本（CommonJS，sandbox 兼容，只能依赖 electron）----
await build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: `${DIST}/preload.js`,
  external: ['electron'],
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});

// ---- 渲染进程（浏览器，IIFE 供 <script> 直接加载）----
await build({
  entryPoints: ['src/renderer/app.ts', 'src/renderer/settings.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outdir: `${DIST}/renderer`,
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
});

// ---- 静态资源（HTML / CSS / assets）----
const staticFiles = [
  'index.html',
  'settings.html',
  'prompt-editor.html',
  'lexicon-playground.html',
  'styles.css',
];
for (const file of staticFiles) {
  await cp(`src/renderer/${file}`, `${DIST}/renderer/${file}`);
}
if (existsSync('src/renderer/assets')) {
  await cp('src/renderer/assets', `${DIST}/renderer/assets`, { recursive: true });
}

console.log('✅ build complete -> dist/');
