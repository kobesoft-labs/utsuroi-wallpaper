#!/usr/bin/env node
// 地球テーマ用のテクスチャを NASA の公開画像から作る (取得 → 段階読み込み用に分割 → WebP → images/earth/)。
//   node tools/build-earth.mjs
//
// 読み込み時間を減らすため、地図ごとに
//   <id>-lo.webp        : 世界全体の小さな地図 (1024x512)。最初にこれだけ読んで、すぐ表示する
//   <id>/<x>_<y>.webp   : 高精細のタイル (4096x2048 を 512px 四方 = 経度・緯度 45° ずつ、横8 x 縦4)。
//                         表示中の視点で見えるタイルだけを読む (地球の裏側は読まない)
// 地図: day-jan/apr/jul/oct (季節の地表) / night (街明かり) / co (R = 雲, G = 海(1)/陸(0), B = 沿岸からの広いぼかし)
//
// 出典 (すべて NASA Visible Earth / Earth Observatory。NASA の画像は原則パブリックドメイン。出典表記: "NASA Earth Observatory"):
//   昼 : Blue Marble Next Generation w/ Topography and Bathymetry (2004年 1/4/7/10月) … 季節ごとの地表 (雪・植生)
//   夜 : Earth at Night 2012 (Black Marble)                                           … 街明かり
//   雲 : Blue Marble clouds
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src', 'earth'), out = path.join(root, 'images', 'earth');
const B = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/';
const W = 4096, H = 2048, T = 512, LO_W = 1024, LO_H = 512;
const FILES = [
  { id: 'day-jan', url: B + '73000/73580/world.topo.bathy.200401.3x5400x2700.jpg', q: 76 },
  { id: 'day-apr', url: B + '73000/73655/world.topo.bathy.200404.3x5400x2700.jpg', q: 76 },
  { id: 'day-jul', url: B + '73000/73751/world.topo.bathy.200407.3x5400x2700.jpg', q: 76 },
  { id: 'day-oct', url: B + '73000/73826/world.topo.bathy.200410.3x5400x2700.jpg', q: 76 },
  { id: 'night', url: B + '79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg', q: 74 },
  { id: 'clouds', url: B + '57000/57747/cloud_combined_2048.jpg' }
];
await fs.mkdir(src, { recursive: true }); await fs.mkdir(out, { recursive: true });

async function fetchRaw(f) {
  const raw = path.join(src, f.id + '.jpg');
  try { await fs.access(raw); } catch {
    process.stdout.write(`取得 ${f.id} ... `);
    const res = await fetch(f.url); if (!res.ok) throw new Error(`${res.status} ${f.url}`);
    const buf = Buffer.from(await res.arrayBuffer()); await fs.writeFile(raw, buf); console.log((buf.length / 1e6).toFixed(1) + 'MB');
  }
  return raw;
}
const rgbAt = async (file, w, h) => (await sharp(file).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;

let total = 0, files = 0;
async function emit(id, full, q) { // full: W x H の RGB
  const img = () => sharp(full, { raw: { width: W, height: H, channels: 3 } });
  const dir = path.join(out, id); await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  let bytes = 0;
  const lo = path.join(out, id + '-lo.webp');
  await img().resize(LO_W, LO_H).webp({ quality: q - 4, effort: 5 }).toFile(lo); const loSize = (await fs.stat(lo)).size; bytes += loSize; files++;
  for (let ty = 0; ty < H / T; ty++) for (let tx = 0; tx < W / T; tx++) {
    const f = path.join(dir, `${tx}_${ty}.webp`);
    await img().extract({ left: tx * T, top: ty * T, width: T, height: T }).webp({ quality: q, effort: 5 }).toFile(f);
    bytes += (await fs.stat(f)).size; files++;
  }
  total += bytes;
  console.log(`${id.padEnd(8)} 粗い地図 ${(loSize / 1024) | 0}KB + タイル32枚 計 ${(bytes / 1024) | 0}KB`);
}

for (const f of FILES.filter((f) => f.id !== 'clouds')) await emit(f.id, await rgbAt(await fetchRaw(f), W, H), f.q);

// 雲 + 海マスク (R = 雲, G = 海, B = 沿岸のぼかし)。元の地図は海底地形入りなので、海は描画側で海底の起伏が見えない色に置き換える
{
  const cl = (await sharp(await fetchRaw(FILES.find((f) => f.id === 'clouds'))).resize(W, H).extractChannel(0).raw().toBuffer({ resolveWithObject: true })).data;
  const jul = await rgbAt(path.join(src, 'day-jul.jpg'), W, H), m = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) { const r = jul[i * 3], g = jul[i * 3 + 1], b = jul[i * 3 + 2]; m[i] = (b > r + 10 && b > g - 25) ? 255 : 0; }   // 青が強い = 海・湖
  const one = async (sigma) => (await sharp(m, { raw: { width: W, height: H, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer({ resolveWithObject: true })).data;
  const water = await one(1.2), coast = await one(14), rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = cl[i]; rgb[i * 3 + 1] = water[i]; rgb[i * 3 + 2] = coast[i]; }
  await emit('co', rgb, 80);
}
// 旧形式 (世界全体を1枚で持つ) のファイルを消す
for (const old of ['day-jan', 'day-apr', 'day-jul', 'day-oct', 'night', 'clouds', 'ocean']) await fs.rm(path.join(out, old + '.webp'), { force: true });
console.log(`合計 ${(total / 1e6).toFixed(2)}MB / ${files}ファイル → images/earth/ (読むのは粗い地図 + 見えるタイルだけ)`);
