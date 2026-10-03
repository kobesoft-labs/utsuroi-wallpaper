#!/usr/bin/env node
// src/sky.js + globe.js + wallpaper.js を結合して配布用ファイルを作る
//   dist/utsuroi.js      : そのまま結合 (読みやすい)
//   dist/utsuroi.min.js  : 圧縮版 (CDN 配信用)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const read = (f) => fs.readFile(path.join(root, 'src', f), 'utf8');
const banner = `/*! utsuroi-wallpaper v${pkg.version} | BSD-3-Clause | https://github.com/kobesoft-labs/utsuroi-wallpaper */\n`;
const code = (await read('sky.js')) + '\n' + (await read('globe.js')) + '\n' + (await read('wallpaper.js'));
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root, 'dist', 'utsuroi.js'), banner + code);
const min = await transform(code, { minify: true, target: 'es2017', legalComments: 'none' });
await fs.writeFile(path.join(root, 'dist', 'utsuroi.min.js'), banner + min.code);
for (const f of ['utsuroi.js', 'utsuroi.min.js']) console.log(`dist/${f}  ${((await fs.stat(path.join(root, 'dist', f))).size / 1024).toFixed(0)}KB`);
