/*!
 * utsuroi-wallpaper — 季節・時間・天気で移ろうライブ壁紙
 * 季節×時間帯の画像をブレンドし、空と天気は UtsuroiSky、地球は UtsuroiGlobe で描く
 * (src/ を直接使う時は sky.js → globe.js → wallpaper.js の順。dist/utsuroi.min.js は全部入りの1ファイル)
 *
 *   <div data-utsuroi="harbor" style="height:100vh"></div>
 *   <script src="dist/utsuroi.min.js"></script>
 *
 * または  Utsuroi.mount('#bg', { theme: 'harbor', lat: 34.69, lon: 135.19 });
 */
(function (global) {
  'use strict';
  var Sky = global.UtsuroiSky;
  if (!Sky) { console.error('[Utsuroi] sky.js を先に読み込んでください'); return; }

  // horizon : 空と地上の境目 (画像高さに対する比)。空マスクが無い時のクリップ線
  // top     : 太陽/月が最高点に来る時の高さ
  // celestial: false なら太陽・月を描かない (地球テーマ)
  // ground / city : 画像が無い時のプレースホルダー用
  var THEMES = {
    mountain: { name: '山',         horizon: 0.50, top: 0.08, ground: [70, 110, 80] },
    city:     { name: '都会',       horizon: 0.58, top: 0.08, ground: [70, 75, 95],  city: true },
    harbor:   { name: '港町',       horizon: 0.55, top: 0.08, ground: [80, 95, 110], city: true },
    kobe:     { name: '神戸',       horizon: 0.62, top: 0.08, ground: [90, 105, 120], city: true },
    tokyo:    { name: '東京',       horizon: 0.42, top: 0.08, ground: [120, 125, 140], city: true },
    cyber:    { name: 'サイバー', waves: false,   horizon: 0.55, top: 0.08, ground: [50, 40, 90],  city: true },
    beach:    { name: 'ビーチ',     horizon: 0.50, top: 0.08, ground: [225, 205, 160] },
    home:     { name: '家',         horizon: 0.55, top: 0.12, ground: [150, 120, 95], layered: true, glass: { box: [0.25, 0.03, 0.99, 0.64], scale: 0.5 } },   // glass: 窓ガラスの範囲 (遠い窓なので水滴は範囲内に小さく)   // 窓の外(季節×時間) + 屋内(時間 + 小物の有無)
    office:   { name: 'オフィス', waves: false,   horizon: 0.55, top: 0.12, ground: [110, 115, 125], city: true, layered: true, outsideShift: 0.1, glass: { box: [0.17, 0.09, 0.97, 0.55], scale: 0.5 } },   // 窓の外の絵を上へずらし、窓の下端に街並みを見せる
    earth:    { name: '地球',       horizon: 0.60, top: 0.10, ground: [40, 90, 140], celestial: false, noSky: true, globe: true },   // NASA の実データで球体を描く (globe.js)   // 空から見た景色: 空の合成・天気は使わない
    temple:   { name: '寺',         horizon: 0.55, top: 0.08, ground: [95, 100, 85] },
    fantasy:  { name: 'ファンタジー', waves: false, mist: [{ x: 0.76, y: 0.93, w: 0.11, s: 1 }, { x: 0.835, y: 0.775, w: 0.06, s: 0.8 }, { x: 0.30, y: 0.675, w: 0.03, s: 0.45 }, { x: 0.425, y: 0.645, w: 0.025, s: 0.4 }],   // 滝つぼの水煙 (画像に対する割合)
    horizon: 0.55, top: 0.08, ground: [40, 90, 70] }
  };
  var TIMES = ['day', 'dawn', 'dusk', 'night'];
  // 屋内の小物セット: アルファで混ぜず「ある/ない」で切り替える (扇風機 = summer, コタツ = winter, どちらも無い = mild)
  function propsetFor(date, lat) {
    var m = date.getMonth() + 1; if (lat < 0) m = ((m + 5) % 12) + 1;
    var v = m * 100 + date.getDate();
    if (v >= 1120 || v <= 320) return 'winter';
    if (v >= 615 && v <= 925) return 'summer';
    return 'mild';
  }

  var SCRIPT_SRC = document.currentScript && document.currentScript.src;
  var DEFAULT_BASE = SCRIPT_SRC ? new URL('../images/', SCRIPT_SRC).href : 'images/';

  // 読み込み: まず CORS ありで試し (画素を読める = 補正が効く)、だめなら属性なしで再試行 (表示とマスクは効く)
  function loadImage(url, ok, fail) {
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () { ok(im); };
    im.onerror = function () { var i2 = new Image(); i2.onload = function () { ok(i2); }; i2.onerror = fail || function () { }; i2.src = url; };
    im.src = url;
  }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---------------------------------------------------------------- プレースホルダー (画像が無い時)
  var SKYC = {
    day: [[95, 160, 230], [200, 225, 245]], dawn: [[70, 85, 150], [255, 175, 140]],
    dusk: [[60, 65, 125], [255, 140, 90]], night: [[5, 8, 25], [28, 38, 75]]
  };
  var GROUND = { spring: [130, 175, 95], summer: [60, 130, 60], autumn: [195, 115, 45], winter: [235, 240, 247] };
  var LIGHT = { day: 1, dawn: 0.6, dusk: 0.55, night: 0.2 };
  // 色のグラデーション: 読み込み中の背景、および画像が無い時の代わり。今の時間帯の空 → 季節の地面 に、地平線のやわらかい光と周辺減光
  function bgColors(T, tb, sb) {
    var top = [0, 0, 0], mid = [0, 0, 0], light = 0, sea = [0, 0, 0];
    tb.forEach(function (b) { for (var c = 0; c < 3; c++) { top[c] += SKYC[b.k][0][c] * b.w; mid[c] += SKYC[b.k][1][c] * b.w; } light += LIGHT[b.k] * b.w; });
    (sb || [{ k: 'summer', w: 1 }]).forEach(function (b) { for (var c = 0; c < 3; c++) sea[c] += GROUND[b.k][c] * b.w; });
    return { top: top, mid: mid, gnd: mix3(mix3(T.ground, sea, 0.55), [0, 0, 0], 1 - light * 0.9), glow: 0.6 * tb.reduce(function (a, b) { return a + (b.k === 'dawn' || b.k === 'dusk' ? b.w : 0); }, 0) };
  }
  function paintGradient(ctx, W, H, hzPx, c, alpha) { // hzPx = 地平線のy(px)
    var g = ctx.createLinearGradient(0, 0, 0, H), h = clamp(hzPx / H, 0.1, 0.9);
    g.addColorStop(0, rgba(c.top, 1)); g.addColorStop(h * 0.55, rgba(mix3(c.top, c.mid, 0.35), 1)); g.addColorStop(h, rgba(c.mid, 1));
    g.addColorStop(clamp(h + 0.04, 0.12, 0.97), rgba(mix3(c.mid, c.gnd, 0.7), 1)); g.addColorStop(clamp(h + 0.1, 0.15, 0.99), rgba(c.gnd, 1)); g.addColorStop(1, rgba(mix3(c.gnd, [0, 0, 0], 0.35), 1));
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (c.glow > 0.05) { // 夜明け・夕方: 地平線のやわらかい光
      var r = ctx.createRadialGradient(W / 2, hzPx, 0, W / 2, hzPx, W * 0.7); r.addColorStop(0, rgba(mix3(c.mid, [255, 190, 140], 0.5), 0.5 * c.glow)); r.addColorStop(1, rgba(c.mid, 0));
      ctx.save(); ctx.translate(0, hzPx); ctx.scale(1, 0.45); ctx.translate(0, -hzPx); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H * 3); ctx.restore();
    }
    var v = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  function bgCss(T, tb, sb) {
    var c = bgColors(T, tb, sb), h = Math.round(T.horizon * 100);
    return 'linear-gradient(to bottom,' + rgba(c.top, 1) + ' 0%,' + rgba(mix3(c.top, c.mid, 0.35), 1) + ' ' + Math.round(h * 0.55) + '%,' + rgba(c.mid, 1) + ' ' + h + '%,' + rgba(c.gnd, 1) + ' ' + Math.min(100, h + 10) + '%,' + rgba(mix3(c.gnd, [0, 0, 0], 0.35), 1) + ' 100%)';
  }
  function gradientFrame(id, season, time, w, h) { // 画像が無い時の代わりの絵: 絵は描かず、季節と時間帯の色だけ
    var c = canvas(w, h); paintGradient(c.getContext('2d'), w, h, h * THEMES[id].horizon, bgColors(THEMES[id], [{ k: time, w: 1 }], [{ k: season, w: 1 }]), 1); return c;
  }

  // ---------------------------------------------------------------- 本体
  function Wallpaper(el, opts) {
    var given = {};
    Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) given[k] = opts[k]; });
    var o = this.o = Object.assign({
      theme: 'mountain', lat: 34.69, lon: 135.19, weather: 'auto', date: null,
      fps: 30, ambient: true, waves: true, base: DEFAULT_BASE, format: 'webp', maxDpr: 1.5, transitions: null,
      place: null, weatherAt: null, weatherProvider: null   // place: 地名 or 'auto' / weatherAt: 天気だけ別の場所 / weatherProvider: 自前の天気 (lat, lon) => {cloud, rain, ...}
    }, given);
    this.el = el;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    if (!el.style.overflow) el.style.overflow = 'hidden';
    var c = this.canvas = canvas(2, 2);
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;pointer-events:none';
    el.insertBefore(c, el.firstChild);
    this.ctx = c.getContext('2d');
    this.scene = canvas(2, 2); this.maskC = canvas(2, 2); this.matteC = canvas(2, 2); this.inner = canvas(2, 2); this.innerImgs = {}; this.innerOn = false;
    this.imgs = {}; this.mattes = {}; this.aspect = 1.5; this.aspectSet = false; this.ph = false; this.maskSrc = null; this.coarse = null; this.matteCount = 0;
    this.dirty = true; this.sceneKey = ''; this.last = 0; this.fade = 0; this.shown = false;
    this.globe = null;
    this.sky = new Sky.Renderer({ lat: o.lat, lon: o.lon, ambient: o.ambient });
    this.sky.setSkyMask(this.maskC);
    var self = this;
    this.ro = new ResizeObserver(function () { self._resize(); }); this.ro.observe(el);
    this.visible = true; this.io = global.IntersectionObserver ? new IntersectionObserver(function (en) { self.visible = en[0].isIntersecting; }) : null; if (this.io) this.io.observe(el);
    this.cost = 0; this.slow = 0;
    if (global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) this.o.fps = Math.min(this.o.fps, 10); // 動きを減らす設定の人には描画頻度を下げる
    this._resize();
    this.setTheme(o.theme);
    if (!el.style.background && !el.style.backgroundImage) { // 画像が来るまでの色 (スクリプト実行直後から出す)
      var d0 = o.date ? new Date(o.date) : new Date(), c0 = Sky.astro.celestial(d0, o.lat, o.lon);
      el.style.background = bgCss(this.T, Sky.util.timeBlend(c0.sun.alt, c0.sun.morning), Sky.util.seasonBlend(d0, o.lat, o.transitions));
    }
    this.setWeather(o.weather);
    if (o.place) this.setPlace(o.place);
    this.running = true;
    this._tick = function (t) { if (!self.running) return; self.raf = requestAnimationFrame(self._tick); self._frame(t); };
    this.raf = requestAnimationFrame(this._tick);
  }
  var P = Wallpaper.prototype;

  P._resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, this.o.maxDpr);
    var w = Math.max(2, Math.round(this.el.clientWidth * dpr)), h = Math.max(2, Math.round(this.el.clientHeight * dpr));
    [this.canvas, this.scene, this.maskC, this.matteC, this.inner].forEach(function (c) { c.width = w; c.height = h; });
    this.W = w; this.H = h; this.dirty = true; this.sceneKey = '';
    this._cover(); this._buildMask();
  };
  P._cover = function () { // 画像を cover で敷いた時の矩形
    var W = this.W, H = this.H, a = this.aspect, dw, dh;
    if (W / H > a) { dw = W; dh = W / a; } else { dh = H; dw = H * a; }
    this.rect = { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
    var sh = (this.T && this.T.outsideShift) || 0;   // 屋内レイヤーは this.rect、窓の外 (絵・空マスク・太陽や月) は上へずらした xrect
    this.xrect = { x: this.rect.x, y: this.rect.y - this.rect.h * sh, w: this.rect.w, h: this.rect.h };
    this.sky.resize(W, H, this.xrect);
    var gl = this.T && this.T.glass, rc = this.rect;   // 水滴は屋内の窓の範囲に限る (手前のレンズではなく、遠い窓ガラスにつく)
    this.sky.setGlass(gl ? { x: rc.x + gl.box[0] * rc.w, y: rc.y + gl.box[1] * rc.h, w: (gl.box[2] - gl.box[0]) * rc.w, h: (gl.box[3] - gl.box[1]) * rc.h } : null, gl ? gl.scale : 1);
  };
  P._url = function (name) { return this.o.base.replace(/\/?$/, '/') + this.theme + '/' + name + '.' + this.o.format; };

  P.setTheme = function (id) {
    if (!THEMES[id]) { console.warn('[Utsuroi] unknown theme:', id); id = 'mountain'; }
    this.theme = id; this.T = THEMES[id]; this.imgs = {}; this.innerImgs = {}; this.innerOn = false; this.shown = false; this.fade = 0; this.mattes = {}; this.matteCount = 0; this.ph = false; this.maskSrc = null; this.coarse = null;
    this.sky.o.horizon = this.T.horizon; this.sky.o.top = this.T.top; this.sky.o.celestial = this.T.celestial !== false;
    this.sky.setCloudMatte(null);
    this._cover(); this.dirty = true; this.sceneKey = ''; this._buildMask();
    var self = this;
    if (this.globe && !this.T.globe) { this.globe.dispose(); this.globe = null; }
    if (this.T.globe) { // 地球: テクスチャを読み込み、WebGL の球体で描く
      if (global.UtsuroiGlobe) {
        var v = this.o.view || [this.o.lat, this.o.lon];   // 見る地点: view 指定、無ければ緯度経度の設定 (既定は神戸)
        this.globe = this.globe || new global.UtsuroiGlobe.Renderer({ viewLat: v[0], viewLon: v[1] });
        this.globe.load(this.o.base.replace(/\/?$/, '/') + id, this.o.format);
      }
      else console.warn('[Utsuroi] globe.js が読み込まれていません');
      return this;
    }
    this.sky.setWater(null); this.sky.setMist(this.T.mist || null);
    loadImage(this._url('mask'), function (im) { if (self.theme === id) { self.coarse = self.maskSrc = im; self.dirty = true; self.sceneKey = ''; } });
    loadImage(this._url('water'), function (im) { if (self.theme === id) self.sky.setWater(im); });
    return this;
  };
  P._buildMask = function () {
    var x = this.maskC.getContext('2d'), r = this.xrect;
    x.clearRect(0, 0, this.W, this.H);
    if (!r || !this.T) return;
    var src = this.maskSrc;
    if (src) { x.drawImage(src, r.x, r.y, r.w, r.h); return; }
    x.fillStyle = '#fff'; x.fillRect(0, 0, this.W, r.y + r.h * this.T.horizon); // マスクが無い間は水平線で切る
  };

  P.setDate = function (d) { this.o.date = d ? new Date(d) : null; return this; };
  P.setWeather = function (w) {
    var self = this; this.o.weather = w; clearTimeout(this._wt);
    if (w === 'auto') {
      var go = function () {
        var at = self.o.weatherAt || [self.o.lat, self.o.lon];   // データ元 (既定: Open-Meteo) は世界中どこでも取れる
        Promise.resolve((self.o.weatherProvider || Sky.weather.fetch)(at[0], at[1])).then(function (r) { if (self.o.weather === 'auto') self.sky.setWeather(r); })
          .catch(function () { }).then(function () { self._wt = setTimeout(go, 15 * 60e3); });
      };
      go();
    } else this.sky.setWeather(w);
    return this;
  };
  /** 場所を緯度経度で変える (太陽・月・季節・天気・地球の中心がすべてその場所に) */
  P.setLocation = function (lat, lon) {
    this.o.lat = +lat; this.o.lon = +lon;
    if (this.globe && !this.o.view) this.globe.setView(this.o.lat, this.o.lon);
    if (this.o.weather === 'auto') this.setWeather('auto');
    return this;
  };
  /** 場所を地名で変える ('札幌' 'Paris' など。'auto' は閲覧者の現在地)。Promise を返す */
  P.setPlace = function (place) {
    var self = this; this.o.place = place;
    return Sky.weather.geocode(place).then(function (p) { if (self.o.place === place) self.setLocation(p.lat, p.lon); return p; })
      .catch(function (e) { console.warn('[Utsuroi]', e.message); });
  };
  /** 地球テーマで見る地点 (緯度・経度) を変える */
  P.setView = function (lat, lon) { this.o.view = [+lat, +lon]; if (this.globe) this.globe.setView(lat, lon); return this; };
  P.info = function (date) { return this.sky.info(date || this.o.date || new Date()); };
  P.destroy = function () { this.running = false; cancelAnimationFrame(this.raf); clearTimeout(this._wt); this.ro.disconnect(); if (this.io) this.io.disconnect(); this.canvas.remove(); delete this.el.__lw; };

  // 画像取得: 読み込み中は null、失敗したらプレースホルダーに切替
  P._frameImg = function (season, time) {
    var key = season + '-' + time, e = this.imgs[key], self = this, theme = this.theme;
    if (e) return e.ready ? e.img : null;
    e = this.imgs[key] = { ready: false };
    if (this.ph) { e.img = gradientFrame(theme, season, time, 720, 480); e.ready = true; return e.img; }
    loadImage(this._url(key), function (im) {
      if (self.theme !== theme) return;
      e.img = im; e.ready = true; self.dirty = true;
      if (!self.aspectSet) { self.aspect = im.naturalWidth / im.naturalHeight; self.aspectSet = true; self._cover(); self._buildMask(); }
    }, function () {
      if (self.theme !== theme) return;
      if (!self.ph) { self.ph = true; self.imgs = {}; self.aspect = 1.5; self._cover(); self._buildMask(); }
      self.dirty = true;
    });
    return null;
  };
  // 雲マット (白=雲): 天体を雲の後ろに回すために使う。無ければ使わない
  P._matte = function (time) {
    var e = this.mattes[time], self = this, theme = this.theme;
    if (e) return e.c;
    e = this.mattes[time] = { c: null };
    loadImage(this._url('cloud-' + time), function (im) { if (self.theme !== theme) return; e.c = im; self.matteCount++; self.dirty = true; });
    return null;
  };

  // 屋内レイヤー (窓が透明な RGBA)。読めない/無い時は何も描かない
  P._innerImg = function (ps, time) {
    var key = ps + '-' + time, e = this.innerImgs[key], self = this, theme = this.theme;
    if (e) return e.ready ? e.img : null;
    e = this.innerImgs[key] = { ready: false };
    loadImage(this._url('in-' + key), function (im) { if (self.theme !== theme) return; e.img = im; e.ready = true; self.dirty = true; });
    return null;
  };
  P._composeInner = function (ps, tb) {
    var x = this.inner.getContext('2d'), r = this.rect, acc = 0, used = false;
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, this.W, this.H);
    var items = [];
    for (var j = 0; j < tb.length; j++) { var im = this._innerImg(ps, tb[j].k); if (im) items.push({ img: im, w: tb[j].w }); }
    items.sort(function (a, b) { return b.w - a.w; });
    for (var i = 0; i < items.length; i++) { acc += items[i].w; x.globalAlpha = used ? items[i].w / acc : 1; x.drawImage(items[i].img, r.x, r.y, r.w, r.h); used = true; }
    var ik = ps + '-'; for (var j2 = 0; j2 < tb.length; j2++) if (this.innerImgs[ik + tb[j2].k]) this.innerImgs[ik + tb[j2].k].used = this.tick;
    x.globalAlpha = 1; this.innerOn = used;
  };

  // メモリ節約: 画像は展開後 1枚約6MB。最近使っていないものから捨てる (また要る時に再読み込み。ブラウザのキャッシュが効く)
  function trim(map, cap) {
    var keys = Object.keys(map).filter(function (k) { return map[k].ready; });
    if (keys.length <= cap) return;
    keys.sort(function (a, b) { return (map[a].used || 0) - (map[b].used || 0); });
    for (var i = 0; i < keys.length - cap; i++) delete map[keys[i]];
  }
  P._compose = function (sb, tb, ps) {
    var items = [], i, j;
    for (i = 0; i < sb.length; i++) for (j = 0; j < tb.length; j++) {
      var w = sb[i].w * tb[j].w; if (w < 0.01) continue;
      var img = this._frameImg(sb[i].k, tb[j].k);
      if (img) items.push({ img: img, w: w, key: sb[i].k + '-' + tb[j].k });
    }
    if (!items.length) return false;
    items.sort(function (a, b) { return b.w - a.w; });
    this.tick = (this.tick || 0) + 1;
    for (var q = 0; q < items.length; q++) if (this.imgs[items[q].key]) this.imgs[items[q].key].used = this.tick;
    this._composeMask(items);
    var x = this.scene.getContext('2d'), r = this.xrect, acc = 0;
    x.globalCompositeOperation = 'source-over';
    for (i = 0; i < items.length; i++) { // 逐次クロスフェード
      acc += items[i].w; x.globalAlpha = i === 0 ? 1 : items[i].w / acc;
      x.drawImage(items[i].img, r.x, r.y, r.w, r.h);
    }
    x.globalAlpha = 1;
    if (this.T.layered) this._composeInner(ps, tb);
    this._composeMatte(tb);
    trim(this.imgs, 6); trim(this.innerImgs, 4);
    return true;
  };
  // 空マスク: 画像ごとに補正したマスクを、画像と同じ重みで混ぜる (輪郭が絵ごとにずれても合う)
  P._maskFor = function (it) {
    var e = this.imgs[it.key]; if (!e || !e.ready) return null;
    if (this.ph) return null;   // 画像が無い時は水平線で空を切る (絵を描かない)
    if (!this.coarse) return null;
    if (e.mask === undefined) e.mask = Sky.util.refineSky(e.img, this.coarse) || false;
    return e.mask || this.coarse;
  };
  P._composeMask = function (items) {
    var x = this.maskC.getContext('2d'), r = this.xrect, acc = 0, used = false;
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, this.W, this.H);
    for (var i = 0; i < items.length; i++) {
      var m = this._maskFor(items[i]); if (!m) continue;
      acc += items[i].w; x.globalAlpha = used ? items[i].w / acc : 1; x.drawImage(m, r.x, r.y, r.w, r.h); used = true;
    }
    x.globalAlpha = 1;
    if (!used) this._buildMask();
  };
  P._composeMatte = function (tb) {
    var m = this.matteC.getContext('2d'), r = this.xrect, acc = 0, any = false;
    m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, this.W, this.H);
    for (var j = 0; j < tb.length; j++) {
      var c = this._matte(tb[j].k); if (!c) continue;
      acc += tb[j].w; m.globalAlpha = acc > 0 ? tb[j].w / acc : 1; m.drawImage(c, r.x, r.y, r.w, r.h); any = true;
    }
    m.globalAlpha = 1; this.sky.setCloudMatte(any ? this.matteC : null);
  };


  // 水面をゆらす: 水面の行を細い横帯に分け、帯ごとに左右へずらす (遠いほど細かく小さい波、手前ほど大きくゆったり)。
  // 帯の枚数は画面の高さの約 1/3 ほど。水面マスクの中だけを描き直すので、岸や建物は動かない
  P._waves = function (ctx, sec) {
    var r = this.xrect, W = this.W, H = this.H, y0 = Math.max(0, Math.floor(r.y + this.T.horizon * r.h)), y1 = Math.min(H, Math.ceil(r.y + r.h)), hh = y1 - y0;
    if (hh < 8) return;
    var wc = this._wv || (this._wv = canvas(2, 2)); if (wc.width !== W || wc.height !== hh) { wc.width = W; wc.height = hh; }
    var g = wc.getContext('2d'), u = Math.max(1, W / 1000), step = Math.max(2, Math.round(H / 240)), swell = 0.8 + 0.2 * Math.sin(sec * 0.17);
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, hh);
    for (var y = 0; y < hh; y += step) {
      var d = y / hh, ph = 62 * Math.sqrt(d + 0.02), amp = u * (0.5 + 7.5 * Math.pow(d, 1.1)) * swell;
      var off = amp * (0.62 * Math.sin(ph - sec * 1.5) + 0.38 * Math.sin(ph * 1.9 + sec * 1.1 + 1.7 * Math.sin(sec * 0.23)));
      var dy = u * (0.4 + 2.2 * d) * Math.sin(ph * 1.3 - sec * 1.9 + 0.8), sy = clamp(y0 + y + dy, 0, H - step);   // 上下にも少し (波の山で映り込みが伸び縮みする)
      g.drawImage(this.scene, 0, sy, W, step, off, y, W, step);
    }
    g.globalCompositeOperation = 'destination-in'; g.drawImage(this.sky.water, r.x, r.y - y0, r.w, r.h);   // 水面の中だけ
    ctx.drawImage(wc, 0, y0);
  };


  // 水面の波 (WebGL): 水面の帯だけを、奥行きのある 2 次元の波で歪ませて描く。
  //   絵は変わった時だけ GPU に送り、毎フレームは時刻を渡して水面の帯を 1 回描くだけ (CPU はほぼ使わない)。
  //   波は遠近で並べた 4 本の進行波の重ね合わせ。その傾きで、うしろの景色 (映り込み) を横と縦にゆがめ、波の斜面を明るさで見せる。
  var WV_VS = 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}';
  var WV_FS = 'precision mediump float;uniform sampler2D S,M;uniform float T,Wd,L;varying vec2 v;' +
    'void main(){' +
    ' float d=1.-v.y; float z=1./(d*.9+.07); vec2 p=vec2((v.x-.5)*Wd*z*.5,z); vec2 g=vec2(0.);' +
    ' vec2 k0=vec2(.94,.34);vec2 k1=vec2(-.55,.83);vec2 k2=vec2(.2,.98);vec2 k3=vec2(-.9,.44);' +
    ' g+=k0*cos(dot(k0,p)*3.1+T*.5)*.55*3.1; g+=k1*cos(dot(k1,p)*5.3+T*.68+1.7)*.4*5.3;' +
    ' g+=k2*cos(dot(k2,p)*8.7-T*.88+.6)*.28*8.7; g+=k3*cos(dot(k3,p)*13.9+T*1.15+2.9)*.16*13.9;' +
    ' float sc=.0016*(.04+pow(d,1.35)*1.15); vec2 uv=v+vec2(g.x*sc*1.5,-g.y*sc*.55);' +
    ' if(texture2D(M,uv).a<.5)uv=v;' +
    ' vec3 c=texture2D(S,uv).rgb; float sl=g.x*.45+g.y*.6;' +
    ' c*=1.+sl*.022*(.2+d); c+=vec3(.9,.95,1.)*pow(max(sl*.12,0.),2.)*L*(.4+d*.6);' +
    ' float al=texture2D(M,v).a; gl_FragColor=vec4(c*al,al);}';
  P._waveGL = function (ctx, sec, env) {
    var r = this.xrect, W = this.W, H = this.H, y0 = Math.max(0, Math.floor(r.y + this.T.horizon * r.h)), y1 = Math.min(H, Math.ceil(r.y + r.h)), hh = y1 - y0;
    if (hh < 8) return true;
    var q = this._wg;
    if (q === false) return false;
    if (!q) {
      var cv = canvas(2, 2), gl = cv.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
      if (!gl) { this._wg = false; return false; }
      var sh = function (type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
      var vs = sh(gl.VERTEX_SHADER, WV_VS), fs = sh(gl.FRAGMENT_SHADER, WV_FS), pr = gl.createProgram();
      if (!vs || !fs) { this._wg = false; return false; }
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this._wg = false; return false; }
      gl.useProgram(pr);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var mk = function (unit) { var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      q = this._wg = { cv: cv, gl: gl, pr: pr, ts: mk(0), tm: mk(1), band: canvas(2, 2), mband: canvas(2, 2), key: '', water: null, W: 0, hh: 0,
        uT: gl.getUniformLocation(pr, 'T'), uW: gl.getUniformLocation(pr, 'Wd'), uL: gl.getUniformLocation(pr, 'L') };
      gl.uniform1i(gl.getUniformLocation(pr, 'S'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'M'), 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }
    var gl2 = q.gl, size = W + 'x' + hh, key = this.sceneKey + '|' + size;
    if (q.W !== W || q.hh !== hh) { q.cv.width = q.band.width = q.mband.width = W; q.cv.height = q.band.height = q.mband.height = hh; q.W = W; q.hh = hh; q.water = null; q.key = ''; gl2.viewport(0, 0, W, hh); }
    if (q.water !== this.sky.water) {                // 水面マスク (絵が変わった時だけ)
      var m = q.mband.getContext('2d'); m.clearRect(0, 0, W, hh); m.drawImage(this.sky.water, r.x, r.y - y0, r.w, r.h);
      gl2.activeTexture(gl2.TEXTURE1); gl2.bindTexture(gl2.TEXTURE_2D, q.tm); gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, q.mband); q.water = this.sky.water;
    }
    if (q.key !== key) {                             // 景色 (季節・時間の混ぜ具合が変わった時だけ)
      q.band.getContext('2d').drawImage(this.scene, 0, y0, W, hh, 0, 0, W, hh);
      gl2.activeTexture(gl2.TEXTURE0); gl2.bindTexture(gl2.TEXTURE_2D, q.ts); gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, q.band); q.key = key;
    }
    gl2.uniform1f(q.uT, sec); gl2.uniform1f(q.uW, W / hh); gl2.uniform1f(q.uL, env && env.day != null ? env.day : 1);
    gl2.clearColor(0, 0, 0, 0); gl2.clear(gl2.COLOR_BUFFER_BIT); gl2.drawArrays(gl2.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(q.cv, 0, y0);
    return true;
  };

  P._frame = function (t) {
    if (document.hidden || !this.visible) return;                // 見えていない時は描かない
    if (t - this.last < 1000 / this.o.fps - 3) return;   // 3ms の余裕: 60Hz の画面で 30fps にしても「33.3ms に 0.1ms 足りない」で 1 つ飛ばして 50ms になる(カクつく)のを防ぐ
    var t0 = performance.now();
    var dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    var date = this.o.date || new Date(), o = this.o;
    this.sky.o.lat = o.lat; this.sky.o.lon = o.lon; this.sky.o.ambient = o.ambient;

    var cel = Sky.astro.celestial(date, o.lat, o.lon);
    var sb = Sky.util.seasonBlend(date, o.lat, o.transitions), tb = Sky.util.timeBlend(cel.sun.alt, cel.sun.morning);
    var ps = this.T.layered ? propsetFor(date, o.lat) : '';
    var key = ps + sb.map(function (s) { return s.k + s.w.toFixed(2); }).join() + tb.map(function (s) { return s.k + s.w.toFixed(2); }).join() + this.matteCount;
    if (!this.T.globe && (this.dirty || (key !== this.sceneKey && (t - (this._ct || 0) > 6000 || !this.sceneKey)))) {   // 季節・時間の混ぜ具合の更新は 6 秒に 1 回まで (合成は重いので、1 フレームだけ長くなってカクつくのを減らす)
      this._ct = t; if (this._compose(sb, tb, ps)) { this.sceneKey = key; this.dirty = false; } }

    var ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.T.globe) {
      if (this.globe && this.globe.ok) { this.globe.resize(this.W, this.H); if (this.globe.render(date, t / 1000)) { ctx.drawImage(this.globe.canvas, 0, 0); this.sceneKey = 'globe'; } }
    } else { ctx.drawImage(this.scene, 0, 0); if (this.o.waves && this.sky.water && !this.T.noSky && this.T.waves !== false && !this._waveGL(ctx, t / 1000)) this._waves(ctx, t / 1000); }
    if (!this.T.noSky) this.sky.render(ctx, { date: date, t: t / 1000, dt: dt, seasons: sb });
    if (this.innerOn) ctx.drawImage(this.inner, 0, 0);   // 窓の外の描画(天気・太陽・月)がすべて終わってから、屋内を手前に重ねる
    if (!this.shown && this.sceneKey && (!this.T.layered || this.innerOn)) this.shown = true;   // 絵がそろったら色から切り替える
    if (this.shown && this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.9);
    if (this.fade < 1) { // 色 → 絵 のクロスフェード (最初は色のグラデーションだけ)
      var f = this.fade * this.fade * (3 - 2 * this.fade);
      if (this.T.globe) { ctx.globalAlpha = 1 - f; ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, this.W, this.H); ctx.globalAlpha = 1; }   // 地球は宇宙の黒から
      else paintGradient(ctx, this.W, this.H, this.xrect.y + this.xrect.h * this.T.horizon, bgColors(this.T, tb, sb), 1 - f);
    }
    this.cost = this.cost * 0.92 + (performance.now() - t0) * 0.08;   // 重い端末では解像度を自動で下げる
    if (this.cost > 14 && o.maxDpr > 1 && ++this.slow > 45) { o.maxDpr = 1; this.slow = 0; this._resize(); }
    if (o.debugMask) { // 空マスクの確認用 (マゼンタ=空)
      var dbg = this._dbg || (this._dbg = canvas(2, 2)); dbg.width = this.W; dbg.height = this.H;
      var dx = dbg.getContext('2d'); dx.drawImage(this.maskC, 0, 0); dx.globalCompositeOperation = 'source-in'; dx.fillStyle = '#f0f'; dx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 0.45; ctx.drawImage(dbg, 0, 0); ctx.globalAlpha = 1;
    }
  };

  // ---------------------------------------------------------------- 公開API
  function resolve(t) { return typeof t === 'string' ? document.querySelector(t) : t; }
  var Utsuroi = {
    themes: THEMES,
    mount: function (target, opts) {
      var el = resolve(target); if (!el) throw new Error('[Utsuroi] target not found: ' + target);
      if (el.__lw) el.__lw.destroy();
      return (el.__lw = new Wallpaper(el, opts));
    },
    util: Sky.util, astro: Sky.astro, weather: Sky.weather
  };

  // <div data-utsuroi="city" data-lat data-lon data-weather="auto|clear|cloudy|drizzle|rain|shower|sunshower|snow|fog|thunder|off" data-time="ISO" data-base data-format data-fps data-ambient="off" data-waves="off" data-view="緯度,経度" data-place="地名|auto" data-weather-at="緯度,経度">
  function auto() {
    var els = document.querySelectorAll('[data-utsuroi]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i], d = e.dataset;
      Utsuroi.mount(e, {
        theme: d.utsuroi, place: d.place || undefined,
        weatherAt: d.weatherAt ? d.weatherAt.split(',').map(Number) : undefined,   // data-weather-at="緯度,経度"
        lat: d.lat ? parseFloat(d.lat) : undefined, lon: d.lon ? parseFloat(d.lon) : undefined,
        weather: d.weather === 'off' ? null : (d.weather || 'auto'),
        date: d.time || null, base: d.base || undefined, format: d.format || undefined,
        fps: d.fps ? parseInt(d.fps, 10) : undefined, ambient: d.ambient !== 'off', waves: d.waves !== 'off',
        view: d.view ? d.view.split(',').map(Number) : undefined   // 地球: data-view="緯度,経度"
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();

  global.Utsuroi = Utsuroi;
})(window);
