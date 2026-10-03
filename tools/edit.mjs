#!/usr/bin/env node
// 1枚だけ画像を編集して差し替える。
//   OPENAI_API_KEY=... node tools/edit.mjs <theme> <file(拡張子なし)> "<編集内容>" [--model <名前>] [--quality medium]
// images-src/<theme>/<file>.png を元に編集し、結果を images/<theme>/<file>.png に書く (そのあと optimize で原本へ退避)。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [theme, file, prompt, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
if (!theme || !file || !prompt) { console.error('usage: edit.mjs <theme> <file> "<prompt>"'); process.exit(1); }
try { for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch { }
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY が未設定です'); process.exit(1); }
const src = [path.join(root, 'images', theme, file + '.png'), path.join(root, 'images-src', theme, file + '.png')];
let from; for (const f of src) { try { await fs.access(f); from = f; break; } catch { } }
if (!from) { console.error('元画像がありません: ' + file); process.exit(1); }
const fd = new FormData();
fd.append('model', opt('model', 'gpt-image-2.5-sunburst')); fd.append('prompt', prompt + ' Keep the exact same camera, framing and composition; everything not mentioned must stay exactly the same.');
fd.append('size', '1536x1024'); fd.append('quality', opt('quality', 'medium')); fd.append('n', '1');
fd.append('image', new Blob([await fs.readFile(from)], { type: 'image/png' }), 'base.png');
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: fd });
if (!res.ok) { console.error(res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const out = path.join(root, 'images', theme, file + '.png');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, Buffer.from((await res.json()).data[0].b64_json, 'base64'));
console.log('wrote', path.relative(root, out));
