# utsuroi-wallpaper

**移ろい ― 季節・時間・天気で移ろうライブ壁紙**

朝焼けから星空まで、桜から雪景色まで。いまの時刻・季節・天気に合わせて、背景がゆっくり移り変わります。
太陽と月は天体計算どおりの位置に昇り、雨の日には窓に雫がつき、夜には街の灯がともります。

ログイン画面を壮大な景色にしたり、サイトのトップを季節で着替えさせたり、受付やサイネージの背景にしたり ── ご自由にどうぞ。

**デモ:** https://kobesoft-labs.github.io/utsuroi-wallpaper/ ・ [時刻・季節・天気を動かせるデモ](https://kobesoft-labs.github.io/utsuroi-wallpaper/demo/)

> *English:* A Japanese-style live wallpaper for the web. Ten scenes (mountain, city, harbor, cyber, beach, home, office, earth, temple, fantasy) blend across seasons and time of day, with a real sun/moon, live weather (rain, snow, fog, thunder) and twinkle-free stars. One `<script>` and one `<div>`. BSD-3-Clause.

---

## いちばん簡単な使い方

```html
<div data-utsuroi="harbor" style="height:100vh"></div>
<script src="https://cdn.jsdelivr.net/gh/kobesoft-labs/utsuroi-wallpaper@1/dist/utsuroi.min.js"></script>
```

これだけで、その場所(既定は神戸)の今の時刻・季節・天気の背景が動きます。画像も CDN から必要な分だけ読み込まれます。

### 壮大なログイン画面の例

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #bg { position: fixed; inset: 0; }                     /* 背景は画面いっぱいに */
    .login { position: relative; width: min(360px, 88vw); margin: 18vh auto 0; padding: 28px;
             border-radius: 16px; background: rgba(255,255,255,.86); box-shadow: 0 20px 60px rgba(0,0,0,.3); }
    .login input, .login button { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 11px; font-size: 15px; border-radius: 8px; }
    .login input { border: 1px solid #ccc; } .login button { border: 0; background: #2b5cd6; color: #fff; }
  </style>
</head>
<body>
  <!-- 東京の今の天気・時刻で、都会の景色 -->
  <div id="bg" data-utsuroi="city" data-lat="35.68" data-lon="139.69"></div>
  <form class="login">
    <h1>ようこそ</h1>
    <input placeholder="メールアドレス"><input type="password" placeholder="パスワード">
    <button>ログイン</button>
  </form>
  <script src="https://cdn.jsdelivr.net/gh/kobesoft-labs/utsuroi-wallpaper@1/dist/utsuroi.min.js"></script>
</body>
</html>
```

ほかにも、たとえばこんな使い方ができます。

- サイトのトップ(ヒーロー部分)を、季節ごとに自動で衣替えする
- 社内ポータルを「オフィス」テーマにして、窓の外の天気を実際の天気と連動させる
- 受付・待合のサイネージに「家」テーマを流して、夜はランプの灯る部屋にする
- 「地球」テーマで、自社の拠点を中心にした宇宙からの眺めを出す

---

## テーマ

| ID | 名前 | 内容 |
|---|---|---|
| `mountain` | 山 | 湖と雪山。夏の夜はホタル |
| `city` | 都会 | 川と高層ビル群 (どこかにありそうな街) |
| `harbor` | 港町 | 坂の家並みと湾 (どこかにありそうな街) |
| `cyber` | サイバー | ネオンの未来都市 |
| `beach` | ビーチ | 南の島の海辺 |
| `home` | 家 | 窓の外は季節と天気、部屋の中は時間で照明が変わる。夏は扇風機、冬はコタツ |
| `office` | オフィス | 窓の外に街並み。夏はデスクファン、冬はツリー |
| `earth` | 地球 | 宇宙から見た地球 (NASA の実データ)。昼夜・季節・月は計算どおり |
| `temple` | 寺 | 五重塔の境内。春は桜、秋は紅葉 |
| `fantasy` | ファンタジー | 大樹のある物語の森 |

## 指定できる属性

| 属性 | 意味 | 例 |
|---|---|---|
| `data-utsuroi` | テーマ ID | `harbor` |
| `data-lat` / `data-lon` | 場所 (太陽・月・天気・季節の計算に使う)。既定は神戸 | `35.68` / `139.69` |
| `data-weather` | `auto` (実際の天気。既定) / `clear` `cloudy` `drizzle` `rain` `shower` `sunshower` `snow` `fog` `thunder` / `off` | `rain` |
| `data-time` | 日時を固定 (ISO 形式)。無ければ現在時刻 | `2026-04-01T06:00` |
| `data-view` | 地球テーマで中心に見る地点 (緯度,経度)。無ければ `data-lat`/`data-lon` | `51.5,-0.12` |
| `data-ambient` | `off` で花びら・落ち葉・ホタルを止める | `off` |
| `data-fps` | 描画の上限 (既定 30) | `20` |
| `data-base` | 画像を自分のサーバーに置く場合の場所 | `/assets/utsuroi/images/` |

天気の `auto` は [Open-Meteo](https://open-meteo.com/) (キー不要) から取得し、15分ごとに更新します。

## JavaScript から使う

```js
const wp = Utsuroi.mount('#bg', { theme: 'mountain', lat: 35.68, lon: 139.69, weather: 'auto' });

wp.setTheme('temple');          // テーマを変える
wp.setWeather('snow');          // 天気を固定 ('auto' で実際の天気に戻す)
wp.setDate('2026-12-24T18:00'); // 日時を固定 (null で現在時刻)
wp.setView(51.5, -0.12);        // 地球テーマの中心をロンドンに
wp.destroy();                   // 片付け
```

天体の計算だけを使うこともできます。

```js
Utsuroi.astro.sunTimes(new Date(), 35.68, 139.69);
// → { sunrise, sunset, dawn, dusk (市民薄明), goldenHourEnd, goldenHourStart, solarNoon, dayLengthMin, ... }
Utsuroi.astro.moonInfo(new Date());   // → { phase, age, illumination, name: '十三夜', ... }
```

### 空と天気だけを、手持ちの写真や背景に重ねる

```js
// 要素の上部 (水平線より上) に、太陽・月・星・雲・雨や雪を重ねる
UtsuroiSky.mount('#hero', { lat: 34.69, lon: 135.19, horizon: 0.6, weather: 'auto' });
```

---

## 見どころと、こだわり

- **季節**: 冬 → 春 (3/25頃) → 夏 (4/20頃) → 秋 (10/27頃) → 冬 (12/11頃)。境目だけ短くクロスフェードするので、2月に桜が咲くことはありません
- **時間**: 太陽の高さで 夜 → 夜明け → 昼 → 夕焼け → 夜 を連続的に混ぜます
- **太陽と月**: 位置・満ち欠けは天体計算どおり。山や建物の後ろに沈み、雲の後ろに隠れます (画像ごとに作った空マスクと雲マスク)
- **天気**: 雨は細い筋と水面の波紋、窓を伝う雫。雪、霧、雷、虹 (天気雨のとき)
- **季節の小さな動き**: 春は花びら、夏の夜はホタル、秋は落ち葉
- **地球**: 日本の上空から見た地球。昼夜の境目は実際の太陽位置、夜側は街明かり、星空は恒星時で回ります
- **軽さ**: 描画は1フレーム1ms未満。画面外では止まり、重い端末では解像度を自動で下げます。画像は必要な分だけ読み、地球は見えるタイルだけを読みます

## 動作環境

最近の Chrome / Edge / Safari / Firefox (スマートフォン含む)。地球テーマは WebGL を使います。
`prefers-reduced-motion` が有効な環境では描画頻度を下げます。

## 自分のサーバーに置く

`dist/utsuroi.min.js` と `images/` を同じ階層関係 (`dist/` の隣に `images/`) で置けば、そのまま動きます。
別の場所に置く場合は `data-base` (JS では `base`) で画像の場所を指定してください。
ローカルで開くときは、`file://` ではなく簡単な HTTP サーバー経由で開いてください (`npm run serve`)。

---

## 画像の作り方 (開発者向け)

背景画像は OpenAI の画像 API で「同じ構図のまま」季節 × 時間帯に展開し、位置合わせしてから WebP にしています。

```bash
cp .env.example .env                 # OPENAI_API_KEY を記入
npm run plan                         # 何枚作るかの確認 (課金なし)
node tools/generate.mjs --theme mountain --model <モデル名>
npm run optimize                     # 原本を images-src/ へ、WebP とマスク類を images/ へ
npm run align && npm run optimize    # 位置合わせ (要: python3 -m venv .venv && .venv/bin/pip install opencv-python-headless numpy)
npm run earth                        # 地球のテクスチャ (NASA から取得 → タイル化)
npm run build                        # dist/utsuroi.js, dist/utsuroi.min.js
```

テーマの内容 (プロンプト) は `themes.json` にあります。新しいテーマを足すのも歓迎です。

| ディレクトリ | 中身 |
|---|---|
| `src/sky.js` | 太陽・月・星・雲・天気・天体計算 (`UtsuroiSky`) |
| `src/globe.js` | 地球の WebGL 描画 (`UtsuroiGlobe`) |
| `src/wallpaper.js` | 画像のブレンドとテーマ管理 (`Utsuroi`) |
| `dist/` | 配布用 (全部入り) |
| `images/` | テーマごとの画像 (季節 × 時間帯、空マスク、雲マスク、水面マスク、室内) |
| `demo/` | デモページ |
| `tools/` | 画像の生成・位置合わせ・最適化・ビルド |

## ライセンス

[BSD 3-Clause License](LICENSE)。商用・非商用を問わず、ご自由にお使いください。

- 背景画像 (`images/` の地球以外): このプロジェクトのために OpenAI の画像 API で生成したもので、コードと同じ BSD 3-Clause で配布します
- 地球の地図 (`images/earth/`): NASA Earth Observatory の Blue Marble Next Generation、Earth at Night 2012 (Black Marble)、Blue Marble clouds を元にしています (NASA の画像は原則パブリックドメイン。出典表記を推奨)
- 天気: [Open-Meteo](https://open-meteo.com/)

Made by [kobesoft-labs](https://github.com/kobesoft-labs).
