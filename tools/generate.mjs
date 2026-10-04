#!/usr/bin/env node
// ベース画像を OpenAI 画像 API で生成し、同じ構図のまま 季節 × 時間帯 に展開する。
//
//   OPENAI_API_KEY=... node tools/generate.mjs --dry-run
//   node tools/generate.mjs --theme tokyo,kobe --quality medium
//
// 1テーマ 17枚: summer-day(新規生成) → 他3季節のday(編集) → 各季節の dawn/dusk/night(編集) → mask(編集)
// 出力: images/<theme>/<season>-<time>.png  ・ 既存ファイルはスキップ (--force で再生成)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(root, 'themes.json'), 'utf8'));

// --- 引数 / 環境変数 ---
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => {
  const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true];
}));
try { // .env を素朴に読む
  for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env なし */ }

const MODEL = args.model || process.env.IMAGE_MODEL || 'gpt-image-1';
const QUALITY = args.quality || 'medium';
const SIZE = args.size || '1536x1024';
const CONCURRENCY = Number(args.concurrency || 3);
const themeIds = (args.theme ? String(args.theme).split(',') : Object.keys(cfg.themes));
const withMask = !args['no-mask'];
const onlyStage = args.stage ? Number(args.stage) : null;   // 指定した段階だけ作る (写真が元のテーマは、段階1のあとに写真へ位置合わせしてから次へ)
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TIMES = ['dawn', 'dusk', 'night'];

// --- ジョブ定義 ---
const KEEP = 'Keep the exact same camera position, framing and composition. Every building, tree, mountain, object and path must stay in exactly the same place and shape. Only change what is described.';
function jobs(id) {
  const t = cfg.themes[id], list = [];
  if (t.globe) return list;   // 地球は NASA の実データを WebGL で描く (tools/build-earth.mjs)
  const out = (name) => path.join(root, 'images', id, name + '.png');
  // 写真が元のテーマ: 実写を「絵」に描き直す (形・位置は写真のまま)。そのあと align.py --pair で写真に合わせ直す
  if (t.photo) list.push({ stage: 1, file: out('summer-day'), kind: 'edit', from: path.join(root, t.photo),
    prompt: `Redraw this photograph as a wide cinematic painterly semi-realistic illustration. ${t.scene} Season: ${cfg.seasons.summer}; ${t.seasonNotes.summer}. Time of day: ${cfg.times.day}; make it a clear bright daytime with a vivid blue sky and a few soft white clouds (the photo was taken near sunset: remove the sunset colors). Remove all people, flags, text, signs and logos. ${KEEP} Keep every building, tower, hill and shoreline at exactly the same position, size and outline as in the photograph, with no distortion, no bending of straight lines and no added or removed buildings. The sun and the moon must NOT be visible. Keep a generous area of open sky in the upper part of the frame. No text, no letters, no logos, no watermark.` });
  else list.push({ stage: 1, file: out('summer-day'), kind: 'generate',
    prompt: `${t.scene} ${cfg.seasons.summer}; ${t.seasonNotes.summer}. Time of day: ${cfg.times.day}. ${cfg.style}` });
  for (const s of SEASONS.filter((s) => s !== 'summer')) list.push({ stage: 2, file: out(`${s}-day`), kind: 'edit', from: out('summer-day'),
    prompt: `Change the season from summer to ${cfg.seasons[s]}; ${t.seasonNotes[s]}. Keep the clear daytime lighting. ${KEEP} ${cfg.style}` });
  for (const s of SEASONS) for (const tm of TIMES) list.push({ stage: 3, file: out(`${s}-${tm}`), kind: 'edit', from: out(`${s}-day`),
    prompt: `Change the time of day to: ${cfg.times[tm]}.${tm === 'night' ? ' ' + t.nightNote + '.' : ''} ${KEEP} ${cfg.style}` });
  if (withMask && !t.noSky) list.push({ stage: 3, file: out('mask'), kind: 'edit', from: out('summer-day'),
    prompt: 'Replace ONLY the sky (everything that is open sky or clouds, including sky seen through windows) with one perfectly flat solid pure magenta color #FF00FF with no gradient and no texture. Leave every other pixel completely unchanged. Do not add anything. Keep the exact same composition.' });
  // 屋内レイヤー (layered テーマ): 窓をマゼンタにした部屋。小物(扇風機/コタツ)は「ある/ない」で別画像にする
  if (t.layered && t.inside) {
    const ins = t.inside, props = Object.keys(ins.props), inFile = (ps, tm) => out(`in-${ps}-${tm}`);
    list.push({ stage: 1, tag: 'inside', file: inFile('mild', 'day'), kind: 'generate', prompt: `${ins.scene} ${ins.times.day}. ${cfg.styleInterior}` });
    for (const ps of props.filter((p) => p !== 'mild')) list.push({ stage: 2, tag: 'inside', file: inFile(ps, 'day'), kind: 'edit', from: inFile('mild', 'day'),
      prompt: `${ins.props[ps]} Keep the exact same camera, room layout and every other object unchanged. ${cfg.styleInterior}` });
    for (const ps of props) for (const tm of TIMES) list.push({ stage: 3, tag: 'inside', file: inFile(ps, tm), kind: 'edit', from: inFile(ps, 'day'),
      prompt: `Change only the lighting to: ${ins.times[tm]}. Keep the exact same camera, room layout and every object unchanged. ${cfg.styleInterior}` });
  }
  // 雲マスク: 太陽・月を雲の後ろに回すための白黒マット (季節は夏の絵から作り、全季節で共用)
  if (!t.noSky) for (const tm of ['day', ...TIMES]) list.push({ stage: 4, tag: 'clouds', file: out(`cloud-${tm}`), kind: 'edit', from: out(`summer-${tm}`),
    prompt: 'Convert this image into a cloud matte. Every cloud becomes white, and the density is preserved: dense clouds pure white, thin wispy clouds light gray. Everything that is NOT cloud (clear sky, any glow, mountains, buildings, trees, sea, ground, stars, lights) becomes pure black #000000. Output a flat black and white image with no color, no shading on the ground. Keep the exact same composition and cloud shapes in exactly the same positions.' });
  // 水面マスク: 海・湖・川だけをマゼンタに (きらめきを水面の中だけに描くため)
  if (t.water) list.push({ stage: 4, tag: 'water', file: out('water'), kind: 'edit', from: out('summer-day'),
    prompt: `Replace ONLY the water surface (${t.water}) with one perfectly flat solid pure magenta color #FF00FF with no gradient, no texture and no reflections. Leave every other pixel completely unchanged: sky, clouds, land, buildings, trees, boats and bridges stay exactly as they are. Keep the exact same composition.` });
  return list;
}

// --- API ---
const KEY = process.env.OPENAI_API_KEY;
async function api(endpoint, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch('https://api.openai.com/v1/images/' + endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
    if (res.ok) return (await res.json()).data[0].b64_json;
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await new Promise((r) => setTimeout(r, 4000 * 2 ** i)); continue; }
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
}
async function run(job) {
  let b64;
  if (job.kind === 'generate') {
    b64 = await api('generations', { model: MODEL, prompt: job.prompt, size: SIZE, quality: QUALITY, n: 1 });
  } else {
    const fd = new FormData();
    fd.append('model', MODEL); fd.append('prompt', job.prompt); fd.append('size', SIZE); fd.append('quality', QUALITY); fd.append('n', '1');
    if (MODEL === 'gpt-image-1') fd.append('input_fidelity', 'high'); // 構図を崩さない
    fd.append('image', new Blob([await fs.readFile(await source(job.from))], { type: 'image/png' }), 'base.png');
    b64 = await api('edits', fd);
  }
  await fs.mkdir(path.dirname(job.file), { recursive: true });
  await fs.writeFile(job.file, Buffer.from(b64, 'base64'));
}
const exists = (f) => fs.access(f).then(() => true, () => false);
// 変換済み(webp)や退避済み(images-src)の画像も「ある」とみなす / 編集元は PNG 原本を探す
const has = async (f) => (await exists(f)) || (await exists(f.replace(/\.png$/, '.webp')));
async function source(f) {
  for (const c of [f, f.replace(`${path.sep}images${path.sep}`, `${path.sep}images-src${path.sep}`)]) if (await exists(c)) return c;
  throw new Error('編集元の PNG がありません: ' + path.relative(root, f) + ' (images-src/ か images/ に必要)');
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

// --- 実行 ---
const all = themeIds.flatMap((id) => { if (!cfg.themes[id]) { console.error('unknown theme:', id); process.exit(1); } return jobs(id); });
const todo = [];
for (const j of all) if (args.only && j.tag !== args.only) continue; else if (onlyStage && j.stage !== onlyStage) continue; else if (args.force || !(await has(j.file))) todo.push(j);
console.log(`model=${MODEL} quality=${QUALITY} size=${SIZE}  テーマ:${themeIds.join(',')}  生成予定 ${todo.length}/${all.length} 枚`);
if (args['dry-run']) { todo.forEach((j) => console.log(' ', path.relative(root, j.file), j.kind)); process.exit(0); }
if (!KEY) { console.error('OPENAI_API_KEY が未設定です (.env か環境変数)'); process.exit(1); }

let done = 0;
for (const stage of [1, 2, 3, 4]) { // 段階順 (編集は前段の画像が必要)
  await pool(todo.filter((j) => j.stage === stage), CONCURRENCY, async (j) => {
    try { await run(j); console.log(`[${++done}/${todo.length}]`, path.relative(root, j.file)); }
    catch (e) { console.error('FAILED', path.relative(root, j.file), e.message); }
  });
}
console.log('完了。失敗があれば同じコマンドを再実行すると続きから生成します。');
