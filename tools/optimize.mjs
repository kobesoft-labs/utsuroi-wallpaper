#!/usr/bin/env node
// 生成した images/**/*.png を配布用 WebP にする。
//   node tools/optimize.mjs [--quality 82] [--max-kb 300]
//   --max-kb: 背景・屋内 1枚あたりの上限。超える時は品質を下げ、それでも超えるなら 1280px → 1024px に落とす
//
// 流れ:  生成直後の PNG (images/) → 原本として images-src/ へ退避
//        → (任意) tools/align.py が images-aligned/ に位置合わせ済みを作る
//        → 位置合わせ済みがあればそれを、無ければ原本を WebP に変換して images/ に出力
//
// 背景(season-time) は通常の WebP。
// 特殊マップ (mask=空 / water=水面 / cloud-*=雲) は「アルファ付き WebP」に焼き込む。
//   → 実行時にキー抜きや画素読み取りが要らない。file:// や別オリジン配信でもマスクが効く。
// 何度実行しても同じ結果になる。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const cfg = JSON.parse(await fs.readFile(new URL('../themes.json', import.meta.url), 'utf8'));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'images'), keep = path.join(root, 'images-src'), aligned = path.join(root, 'images-aligned');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? Number(argv[i + 1]) : def; };
const quality = opt('quality', 82);              // 開始品質
const maxBytes = opt('max-kb', 300) * 1024;      // 背景・屋内 1枚あたりの上限。超えたら品質→解像度の順に下げる
const onlyTheme = argv.includes('--theme') ? argv[argv.indexOf('--theme') + 1] : null;   // 指定したテーマだけ処理 (生成中の他テーマに触れない)
const MAP_W = 768;                               // マスク/雲/水面は滑らかなので低解像度で足りる (描画時に拡大)
const clamp = (v) => Math.max(0, Math.min(1, v));
const isInterior = (f) => f.startsWith('in-');   // 屋内レイヤー: 窓のマゼンタを透明に抜く
const isMap = (f) => f === 'mask.png' || f === 'water.png' || f.startsWith('cloud-');
const exists = (f) => fs.access(f).then(() => true, () => false);
let n = 0, bytes = 0, usedAligned = 0;

async function encodeBudget(input, dest, alpha) { // 上限に収まる最高品質を探す。収まらなければ解像度を下げる
  const base = sharp(input), meta = await base.metadata();
  for (const width of [meta.width, 1280, 1024]) {
    for (let q = quality; q >= 46; q -= 6) {
      const buf = await sharp(input).resize({ width, withoutEnlargement: true }).webp(alpha ? { quality: q, alphaQuality: 100, effort: 5 } : { quality: q, effort: 5 }).toBuffer();
      if (buf.length <= maxBytes || (width === 1024 && q <= 46)) { await fs.writeFile(dest, buf); return; }
    }
  }
}

async function bake(file, dest) { // 白 + アルファ。mask/water は マゼンタ→不透明、cloud は 明るさ→不透明
  const { data, info } = await sharp(file).resize({ width: MAP_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height, rgba = Buffer.alloc(px * 4), magenta = !path.basename(file).startsWith('cloud-');
  for (let i = 0; i < px; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const a = magenta ? clamp((Math.min(r, b) - g - 60) / 80) : clamp(((r + g + b) / 3 - 25) / 190);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = Math.round(a * 255);
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ lossless: true, effort: 4 }).toFile(dest);
}

function holeDistance(alpha, w, h) { // 窓(透明)からの距離 (チャムファー変換)
  const INF = 1e6, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] < 128 ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.414); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i]; if (!v) continue;
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.414); if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414); }
    d[i] = v;
  }
  return d;
}
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

async function bakeInterior(file, dest, zones = []) {
  // 窓ガラスのマゼンタを透明に抜き、窓の反射光(赤紫の色被り)を取り除く。
  //  1) 穴の縁 約1.5px は混ざった画素なので削る  2) 窓に近いほど強く、赤と青の飛び出し分を消して緑を少し戻す (扇風機の網・観葉植物の葉の紫対策)
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, px = w * h, alpha = new Uint8Array(px);
  for (let i = 0; i < px; i++) alpha[i] = Math.round((1 - clamp((Math.min(data[i * 3], data[i * 3 + 2]) - data[i * 3 + 1] - 40) / 60)) * 255);
  const dist = holeDistance(alpha, w, h), rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    let r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2], a = alpha[i] / 255;
    const m0 = Math.min(r, b) - g, nearW = 1 - smoothstep(60, 180, dist[i]);
    if (dist[i] <= 1.5) a = 0;                                           // 縁を削る
    else {
      if (a < 1) { r = g + (r - g) * a; b = g + (b - g) * a; }
      // 窓の近くで赤紫が混ざった画素 (扇風機の網・葉の縁): 灰色寄りに戻し、赤紫が強いほど透明に近づける
      const mu = clamp((m0 - 2) / 40) * nearW;
      if (mu > 0) { r += (g * 1.06 - r) * mu; b += (g * 0.96 - b) * mu; a *= 1 - 0.65 * mu; }
    }
    const near = 1 - smoothstep(20, 90, dist[i]), wgt = Math.max(0.2, near);       // 窓に近いほど強く (遠くも弱くは効かせる)
    const cast = Math.min(r, b) - g;
    if (cast > 2) { const k = Math.min(1, (cast - 2) / 10) * wgt; r -= cast * k; b -= cast * k; g += cast * k * 0.3; }
    // 指定範囲(扇風機・観葉植物など)の中の赤紫・ピンクは、本来の色味へ明るさを保ったまま戻す (赤み・橙・緑はそのまま)
    if (a > 0 && zones.length) {
      const px_ = (i % w) / w, py_ = ((i / w) | 0) / h;
      for (const z of zones) {
        if (px_ < z.box[0] || px_ > z.box[2] || py_ < z.box[1] || py_ > z.box[3]) continue;
        const L = 0.3 * r + 0.59 * g + 0.11 * b, t = z.tone, tl = 0.3 * t[0] + 0.59 * t[1] + 0.11 * t[2];
        const purple = b > g + 3 && r > g + 3;        // 赤も青も緑より強い = 赤紫・ピンク・紫
        const k = z.force ? z.force : (purple ? 1 : 0);   // force: 範囲内の全画素の色味を揃える (時間帯の青い光でも扇風機が紫に見えないように)
        if (k > 0) { r += (L * t[0] / tl - r) * k; g += (L * t[1] / tl - g) * k; b += (L * t[2] / tl - b) * k; }
      }
    }
    rgba[i * 4] = Math.max(0, Math.min(255, r)); rgba[i * 4 + 1] = Math.max(0, Math.min(255, g)); rgba[i * 4 + 2] = Math.max(0, Math.min(255, b)); rgba[i * 4 + 3] = Math.round(a * 255);
  }
  await encodeBudget(await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(), dest, true);
}

for (const dir of (await fs.readdir(out)).filter((x) => !onlyTheme || x === onlyTheme)) {
  const d = path.join(out, dir);
  if (!(await fs.stat(d)).isDirectory()) continue;
  await fs.mkdir(path.join(keep, dir), { recursive: true });
  for (const f of (await fs.readdir(d)).filter((f) => f.endsWith('.png'))) await fs.rename(path.join(d, f), path.join(keep, dir, f)); // 新しい原本を退避
}
for (const dir of (await fs.readdir(keep)).filter((x) => !onlyTheme || x === onlyTheme)) {
  const k = path.join(keep, dir);
  if (!(await fs.stat(k)).isDirectory()) continue;
  await fs.mkdir(path.join(out, dir), { recursive: true });
  for (const f of (await fs.readdir(k)).filter((f) => f.endsWith('.png'))) {
    const al = path.join(aligned, dir, f), use = (await exists(al)) ? al : path.join(k, f), dest = path.join(out, dir, f.replace(/\.png$/, '.webp'));
    if (use === al) usedAligned++;
    if (isMap(f)) await bake(use, dest); else if (isInterior(f)) await bakeInterior(use, dest, cfg.themes[dir]?.inside?.despill || []); else await encodeBudget(use, dest, false);
    bytes += (await fs.stat(dest)).size; n++;
  }
}
console.log(`上限 ${maxBytes / 1024 | 0}KB/枚。${n}枚を出力 (${(bytes / 1e6).toFixed(1)}MB)、うち位置合わせ済み ${usedAligned}枚。原本は images-src/`);
