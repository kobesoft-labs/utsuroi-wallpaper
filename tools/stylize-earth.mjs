#!/usr/bin/env node
// NASA の地図(assets-src/earth/*.jpg)を AI で絵画風に描き直し、地球テーマのテクスチャにする。
//   OPENAI_API_KEY=... node tools/stylize-earth.mjs [--only day-jul] [--model gpt-image-2.5-sunburst]
//
//  1) 見える範囲 (東経50°→西経130°, 北緯80°→南緯40°) を切り出して 1536x1024 に
//  2) AI で描き直す (地形の形は保つよう指示)
//  3) 描き直しは数pxずれるので、オプティカルフローで元の地図の海岸線に合わせ直す (tools/align.py --pair)
//  4) 4096x2048 の世界地図に戻して埋め込む。範囲外は元の地図の色味を描き直しに合わせ、境目はぼかしてつなぐ
//  出力: images/earth/<id>.webp (tools/build-earth.mjs の出力を置き換える)
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
try { for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch { }
const KEY = process.env.OPENAI_API_KEY; if (!KEY) { console.error('OPENAI_API_KEY が未設定です'); process.exit(1); }
const MODEL = opt('model', 'gpt-image-2.5-sunburst');
const src = path.join(root, 'assets-src', 'earth'), work = path.join(root, 'assets-src', 'earth', 'work'), out = path.join(root, 'images', 'earth');
await fs.mkdir(work, { recursive: true });

const KEEP = 'Keep the exact same equirectangular map projection, framing and scale. Every coastline, island, peninsula, lake, river, mountain range and snow or ice area must stay exactly where it is: do not move, add or remove any land. No text, no labels, no grid lines, no borders, no frame.';
const STYLE_DAY = 'Repaint this satellite map of the Earth as a refined painterly illustration in the style of high-quality anime background art and soft gouache: rich but natural colors, gentle hand-painted brush texture on the land, soft painted texture on the oceans with clear blue gradients from shallow to deep water. ' + KEEP;
const STYLE_NIGHT = 'Repaint this night-time map of city lights as an artistic painterly illustration: warm golden city lights with a soft painted glow, delicate lines of light along roads and coasts, on a deep calm navy-black background with subtle painted texture. Every light cluster must stay exactly in the same position. ' + KEEP;
const JOBS = [
  { id: 'day-jan', prompt: STYLE_DAY + ' Season: northern winter with snow.' },
  { id: 'day-apr', prompt: STYLE_DAY + ' Season: northern spring.' },
  { id: 'day-jul', prompt: STYLE_DAY + ' Season: northern summer, lush green.' },
  { id: 'day-oct', prompt: STYLE_DAY + ' Season: northern autumn.' },
  { id: 'night', prompt: STYLE_NIGHT }
].filter((j) => !opt('only') || opt('only').split(',').includes(j.id));

// 範囲: 経度 50°E から 180° 分 (西経130°まで), 緯度 80°N → 40°S (120° 分)
// --detail: 日本周辺だけを高解像度で描き直した「詳細地図」を作る (東経112°〜166°, 北緯56°〜20°。広域の約3倍の精細さ)
const DETAIL = argv.includes('--detail');
const W = 4096, H = 2048, LON0 = DETAIL ? 112 : 50, LON_SPAN = DETAIL ? 54 : 180, LAT_TOP = DETAIL ? 56 : 80, LAT_SPAN = DETAIL ? 36 : 120;
const SRC_W = DETAIL ? 5400 : W, SRC_H = DETAIL ? 2700 : H;   // 詳細は NASA の原寸 (5400x2700) から切り出す
const rx = Math.round((LON0 + 180) / 360 * SRC_W), rw = Math.round(LON_SPAN / 360 * SRC_W), ry = Math.round((90 - LAT_TOP) / 180 * SRC_H), rh = Math.round(LAT_SPAN / 180 * SRC_H);

async function rawRGB(file, w, h) { const { data } = await sharp(file).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return data; }
function cropWrap(full, x0, y0, w, h, FW = W) { // 経度方向は回り込む
  const outB = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = (x0 + x) % FW, i = ((y0 + y) * FW + sx) * 3, o = (y * w + x) * 3; outB[o] = full[i]; outB[o + 1] = full[i + 1]; outB[o + 2] = full[i + 2]; }
  return outB;
}
function stats(buf) { const n = buf.length / 3, m = [0, 0, 0], v = [0, 0, 0]; for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) m[c] += buf[i + c]; for (let c = 0; c < 3; c++) m[c] /= n; for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) v[c] += (buf[i + c] - m[c]) ** 2; return { m, s: v.map((x) => Math.sqrt(x / n) || 1) }; }

for (const job of JOBS) {
  const orig = path.join(src, job.id + '.jpg');
  const full = await rawRGB(orig, SRC_W, SRC_H);
  // 1) 切り出し
  const region = cropWrap(full, rx, ry, rw, rh, SRC_W);
  const tag = (DETAIL ? 'detail-' : '') + job.id;
  const cropPng = path.join(work, tag + '-crop.png');
  await sharp(region, { raw: { width: rw, height: rh, channels: 3 } }).resize(1536, 1024, { fit: 'fill' }).png().toFile(cropPng);
  // 2) AI で描き直し
  const styled = path.join(work, tag + '-styled.png');
  try { await fs.access(styled); console.log(job.id, '描き直し済みを使用'); } catch {
    process.stdout.write(job.id + ' 描き直し中 ... ');
    const fd = new FormData();
    fd.append('model', MODEL); fd.append('prompt', job.prompt); fd.append('size', '1536x1024'); fd.append('quality', opt('quality', 'high')); fd.append('n', '1');
    fd.append('image', new Blob([await fs.readFile(cropPng)], { type: 'image/png' }), 'map.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: fd });
    if (!res.ok) { console.error(res.status, (await res.text()).slice(0, 300)); continue; }
    await fs.writeFile(styled, Buffer.from((await res.json()).data[0].b64_json, 'base64')); console.log('ok');
  }
  // 3) 元の地図の位置に合わせ直す
  const alignedPng = path.join(work, tag + '-aligned.png');
  execFileSync(path.join(root, '.venv', 'bin', 'python'), [path.join(root, 'tools', 'align.py'), '--pair', cropPng, styled, alignedPng, '--max-shift', '10'], { stdio: 'inherit' });
  if (DETAIL) { // 詳細地図: 広域の地図(描き直し済み)の同じ範囲と色味を合わせ、2048x1024 で保存 (描画側で境目をぼかしてつなぐ)
    const wide = await rawRGB(path.join(out, job.id + '.webp'), W, H);
    const wx = Math.round((LON0 + 180) / 360 * W), ww = Math.round(LON_SPAN / 360 * W), wy = Math.round((90 - LAT_TOP) / 180 * H), wh = Math.round(LAT_SPAN / 180 * H);
    const ref = cropWrap(wide, wx, wy, ww, wh), det = await rawRGB(alignedPng, 2048, 1024), sr = stats(ref), sd = stats(det);
    for (let i = 0; i < det.length; i += 3) for (let c = 0; c < 3; c++) det[i + c] = Math.max(0, Math.min(255, (det[i + c] - sd.m[c]) / sd.s[c] * sr.s[c] + sr.m[c]));
    const dest = path.join(out, 'detail-' + job.id + '.webp');
    await sharp(det, { raw: { width: 2048, height: 1024, channels: 3 } }).webp({ quality: 80, effort: 5 }).toFile(dest);
    console.log(`→ ${path.relative(root, dest)}  ${((await fs.stat(dest)).size / 1024) | 0}KB`);
    continue;
  }
  // 4) 世界地図に埋め込む
  const sty = await rawRGB(alignedPng, rw, rh), so = stats(region), ss = stats(sty), F = 70;   // F: 境目をぼかす幅(px)
  const base = Buffer.from(full);
  for (let i = 0; i < base.length; i += 3) for (let c = 0; c < 3; c++) base[i + c] = Math.max(0, Math.min(255, (base[i + c] - so.m[c]) / so.s[c] * ss.s[c] + ss.m[c]));   // 範囲外: 色味を描き直しに合わせる
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const e = Math.min(x, rw - 1 - x, y, rh - 1 - y), a = Math.min(1, e / F), k = a * a * (3 - 2 * a);
    const sx = (rx + x) % W, bi = ((ry + y) * W + sx) * 3, si = (y * rw + x) * 3;
    for (let c = 0; c < 3; c++) base[bi + c] = base[bi + c] * (1 - k) + sty[si + c] * k;
  }
  const dest = path.join(out, job.id + '.webp');
  await sharp(base, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: job.id === 'night' ? 72 : 74, effort: 5 }).toFile(dest);
  console.log(`→ ${path.relative(root, dest)}  ${((await fs.stat(dest)).size / 1024) | 0}KB`);
}
