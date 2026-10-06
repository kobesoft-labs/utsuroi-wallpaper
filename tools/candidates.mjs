#!/usr/bin/env node
// 写真が元のテーマの「夏の昼」を、同じ指示で何枚か描かせる (出来は毎回違うので、形が写真に一番近いものを選ぶため)。
//   node tools/candidates.mjs <theme> [枚数] [出力先フォルダ]   → <出力先>/cand-N.png
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [theme, n = '6', outDir = '/tmp/cand'] = process.argv.slice(2);
const cfg = JSON.parse(await fs.readFile(path.join(root, 'themes.json'), 'utf8')), t = cfg.themes[theme];
for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const KEEP = 'Keep the exact same camera position, framing and composition. Every building, tree, mountain, object and path must stay in exactly the same place and shape.';
const prompt = `Redraw this photograph as a wide cinematic painterly semi-realistic illustration. ${t.scene} Season: ${cfg.seasons.summer}; ${t.seasonNotes.summer}. Time of day: ${cfg.times.day}; make it a clear bright daytime with a vivid blue sky and a few soft white clouds (the photo was taken near sunset: remove the sunset colors). Remove all people, flags, text, signs and logos. ${KEEP} Trace the outline of every building from the photograph exactly: straight edges stay perfectly straight, vertical walls stay perfectly vertical, flat roofs stay flat, and each building keeps its exact width, height and proportions (do NOT curve, bend, lean, taper or round any tower, and do NOT redesign the roof tops). Do not add or remove buildings. ${t.extraKeep || ''} The sun and the moon must NOT be visible. Keep a generous area of open sky in the upper part of the frame. No text, no letters, no logos, no watermark.`;
await fs.mkdir(outDir, { recursive: true });
const photo = await fs.readFile(path.join(root, t.photo));
await Promise.all(Array.from({ length: Number(n) }, async (_, i) => {
  const fd = new FormData();
  fd.append('model', 'gpt-image-2.5-sunburst'); fd.append('prompt', prompt); fd.append('size', '1536x1024'); fd.append('quality', 'medium'); fd.append('n', '1');
  fd.append('image', new Blob([photo], { type: 'image/png' }), 'base.png');
  for (let k = 0; k < 4; k++) {
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: fd });
    if (res.ok) { await fs.writeFile(path.join(outDir, `cand-${i}.png`), Buffer.from((await res.json()).data[0].b64_json, 'base64')); console.log('ok', i); return; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 4000 * 2 ** k)); continue; }
    console.error('FAILED', i, res.status, (await res.text()).slice(0, 200)); return;
  }
}));
