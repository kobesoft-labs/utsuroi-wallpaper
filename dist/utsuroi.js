/*! utsuroi-wallpaper v1.1.1 | BSD-3-Clause | https://github.com/kobesoft-labs/utsuroi-wallpaper */
/*!
 * Utsuroi Sky — 太陽・月・星・雲・天気 を Canvas で描く、背景画像に依存しないライブラリ
 *
 * 1) 計算だけ使う
 *      UtsuroiSky.astro.sunTimes(new Date(), 34.69, 135.19)   // 日の出・日の入り・薄明・ゴールデンアワー
 *      UtsuroiSky.astro.moonInfo(new Date())                  // 月相・輝面比・月齢・名前
 * 2) 任意の要素に空を重ねる (CSS背景・<img>・写真の上など)
 *      UtsuroiSky.mount('#hero', { lat, lon, horizon: 0.6, weather: 'auto' })
 * 3) 自前の Canvas に描く
 *      var r = new UtsuroiSky.Renderer({ lat, lon, horizon, top });
 *      r.resize(w, h, rect); r.setSkyMask(maskCanvas); r.render(ctx, { date, t, dt });
 */
(function (global) {
  'use strict';

  var RAD = Math.PI / 180, TAU = Math.PI * 2;

  // ------------------------------------------------------------------ ユーティリティ
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (+a).toFixed(3) + ')'; }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  function clean(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  function glow(g, x, y, rad, col, stops) {
    var gr = g.createRadialGradient(x, y, 0, x, y, rad);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], rgba(col, stops[i][1]));
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // ------------------------------------------------------------------ 天文 (壁紙用の簡易式)
  function eclToEq(lambda, beta, n) { // 黄道座標 → 赤道座標 (赤経・赤緯, ラジアン)
    var eps = (23.439 - 0.0000004 * n) * RAD, b = beta || 0;
    return {
      ra: Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(lambda)),
      dec: Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(lambda))
    };
  }
  function eclToHorizontal(lambda, date, lat, lon, beta) {
    var jd = date.getTime() / 864e5 + 2440587.5, n = jd - 2451545.0;
    var eq = eclToEq(lambda, beta, n), ra = eq.ra, dec = eq.dec;
    var gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
    var H = gmst * 15 * RAD + lon * RAD - ra;
    H = Math.atan2(Math.sin(H), Math.cos(H)); // -π..π (0 = 南中)
    var la = lat * RAD;
    var alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
    var A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / RAD; // 南から西回り
    var az = lat >= 0 ? A : A - (A >= 0 ? 180 : -180); // 画面は北半球=南向き / 南半球=北向き。右が正
    return { alt: alt / RAD, az: az, morning: H < 0 };
  }
  function sunLambda(date) {
    var n = date.getTime() / 864e5 + 2440587.5 - 2451545.0;
    var L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * RAD;
    return (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  }
  /** 月の位置 (黄経・黄緯・距離)。Meeus の簡易式で約1°の精度 */
  function moonEcl(date) {
    var d = date.getTime() / 864e5 + 2440587.5 - 2451545.0;
    var L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.229350 * d) * RAD;
    return { lambda: L + 6.289 * RAD * Math.sin(M), beta: 5.128 * RAD * Math.sin(F), distKm: 385001 - 20905 * Math.cos(M) };
  }
  function moonPhase(date) { // 0=新月 0.5=満月
    var p = ((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1;
    return p < 0 ? p + 1 : p;
  }
  function celestial(date, lat, lon) {
    var sl = sunLambda(date), ph = moonPhase(date);
    var me = moonEcl(date);
    return { sun: eclToHorizontal(sl, date, lat, lon), moon: eclToHorizontal(me.lambda, date, lat, lon, me.beta), phase: ph };
  }
  function altOf(kind, ms, lat, lon) {
    var d = new Date(ms), sl = sunLambda(d);
    if (kind === 'sun') return eclToHorizontal(sl, d, lat, lon).alt;
    var me = moonEcl(d); return eclToHorizontal(me.lambda, d, lat, lon, me.beta).alt;
  }
  // その日(ローカル0時〜24時)を5分刻みで走査して、高度が基準を横切る時刻を求める
  function scanDay(kind, date, lat, lon) {
    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), step = 5 * 60e3, a = [];
    for (var i = 0; i <= 288; i++) a.push(altOf(kind, start + i * step, lat, lon));
    return { a: a, start: start, step: step };
  }
  function cross(sc, th) {
    var res = { rise: null, set: null };
    for (var i = 1; i < sc.a.length; i++) {
      var p = sc.a[i - 1] - th, c = sc.a[i] - th, t = sc.start + (i - 1) * sc.step + sc.step * (-p) / (c - p);
      if (p < 0 && c >= 0 && !res.rise) res.rise = new Date(t);
      if (p >= 0 && c < 0 && !res.set) res.set = new Date(t);
    }
    return res;
  }
  /** 日の出・日の入りなど。精度は±1〜2分程度。極地で昼/夜が続く日は polar が 'day' | 'night' */
  function sunTimes(date, lat, lon) {
    var sc = scanDay('sun', date, lat, lon), rs = cross(sc, -0.833), civil = cross(sc, -6), naut = cross(sc, -12), gold = cross(sc, 6);
    var mi = 0; for (var i = 1; i < sc.a.length; i++) if (sc.a[i] > sc.a[mi]) mi = i;
    var polar = (!rs.rise && !rs.set) ? (sc.a[mi] > -0.833 ? 'day' : 'night') : null;
    return {
      sunrise: rs.rise, sunset: rs.set,
      dawn: civil.rise, dusk: civil.set,                        // 市民薄明 (太陽高度 -6°)
      nauticalDawn: naut.rise, nauticalDusk: naut.set,          // 航海薄明 (-12°)
      goldenHourEnd: gold.rise, goldenHourStart: gold.set,      // 太陽高度 6° 以下
      solarNoon: new Date(sc.start + mi * sc.step),
      dayLengthMin: rs.rise && rs.set ? Math.round((rs.set - rs.rise) / 60e3) : (polar === 'day' ? 1440 : 0),
      maxAltitude: sc.a[mi], polar: polar
    };
  }
  /** 月の出・月の入り (簡易計算のため数十分の誤差あり) */
  function moonTimes(date, lat, lon) {
    var sc = scanDay('moon', date, lat, lon), r = cross(sc, 0);
    return { moonrise: r.rise, moonset: r.set };
  }
  /** 太陽が真上に来る地点 (緯度・経度, 度)。地球を球体で描く時の昼夜の境目に使う */
  function subpoint(date, lambda, beta) { // 天体が真上に来る地点 (緯度・経度, 度)
    var n = date.getTime() / 864e5 + 2440587.5 - 2451545.0, eq = eclToEq(lambda, beta, n);
    var gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24, lon = eq.ra / RAD - gmst * 15;
    return { lat: eq.dec / RAD, lon: ((lon + 540) % 360) - 180 };
  }
  function subsolar(date) { return subpoint(date, sunLambda(date), 0); }
  /** 月が真上に来る地点 + 地球からの距離(km) */
  function sublunar(date) { var me = moonEcl(date), p = subpoint(date, me.lambda, me.beta); p.distKm = me.distKm; return p; }
  var PHASE_NAMES = ['新月', '三日月', '上弦の月', '十三夜', '満月', '十八夜', '下弦の月', '有明月'];
  function moonInfo(date) {
    var p = moonPhase(date);
    return { phase: p, age: p * 29.530588853, illumination: (1 - Math.cos(p * TAU)) / 2, waxing: p < 0.5, name: PHASE_NAMES[Math.round(p * 8) % 8] };
  }

  // 季節の重み: 各季節をしばらく保ち、境目だけ短くクロスフェードする (c=中心の通算日, w=幅(日))
  var TRANSITIONS = [
    { c: 84, w: 14, a: 'winter', b: 'spring' },  // 3/25 頃  桜の頃から春
    { c: 110, w: 20, a: 'spring', b: 'summer' }, // 4/20 頃  桜が終わり新緑へ
    { c: 300, w: 20, a: 'summer', b: 'autumn' }, // 10/27 頃 色づき始め
    { c: 345, w: 16, a: 'autumn', b: 'winter' }  // 12/11 頃 落葉
  ];
  function dayOfYear(d) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
  function seasonBlend(date, lat, tr) {
    tr = tr || TRANSITIONS;
    var d = dayOfYear(date);
    if (lat < 0) d = ((d + 182) % 365) || 365;
    for (var i = 0; i < tr.length; i++) {
      var lo = tr[i].c - tr[i].w / 2, hi = tr[i].c + tr[i].w / 2;
      if (d >= lo && d <= hi) { var t = smooth(lo, hi, d); return [{ k: tr[i].a, w: 1 - t }, { k: tr[i].b, w: t }]; }
    }
    if (d < tr[0].c) return [{ k: 'winter', w: 1 }];
    if (d < tr[1].c) return [{ k: 'spring', w: 1 }];
    if (d < tr[2].c) return [{ k: 'summer', w: 1 }];
    if (d < tr[3].c) return [{ k: 'autumn', w: 1 }];
    return [{ k: 'winter', w: 1 }];
  }
  // 時間帯の重み: 太陽高度で night → dawn → day → dusk → night を滑らかに繋ぐ
  function timeBlend(alt, morning) {
    var stops = morning
      ? [{ a: -14, k: 'night' }, { a: -3, k: 'dawn' }, { a: 10, k: 'day' }]
      : [{ a: 10, k: 'day' }, { a: -2, k: 'dusk' }, { a: -14, k: 'night' }];
    if (!morning) stops.reverse(); // 高度の昇順 (night, dawn|dusk, day)
    if (alt <= stops[0].a) return [{ k: stops[0].k, w: 1 }];
    if (alt >= stops[2].a) return [{ k: stops[2].k, w: 1 }];
    var i = alt < stops[1].a ? 0 : 1, t = smooth(stops[i].a, stops[i + 1].a, alt);
    return [{ k: stops[i].k, w: 1 - t }, { k: stops[i + 1].k, w: t }];
  }

  // ------------------------------------------------------------------ 天気
  // cloud 雲量 / rain 雨(0.2=霧雨 0.5=しとしと 0.8=本降り) / snow / fog / thunder / wind(m/s)
  var PRESETS = {
    clear:     { cloud: 0.05, rain: 0,    snow: 0,   fog: 0,    thunder: false, wind: 1 },
    cloudy:    { cloud: 0.7,  rain: 0,    snow: 0,   fog: 0,    thunder: false, wind: 3 },
    drizzle:   { cloud: 0.8,  rain: 0.22, snow: 0,   fog: 0.2,  thunder: false, wind: 1 },
    rain:      { cloud: 0.85, rain: 0.5,  snow: 0,   fog: 0.25, thunder: false, wind: 2 },
    shower:    { cloud: 0.9,  rain: 0.8,  snow: 0,   fog: 0.15, thunder: false, wind: 4 },
    sunshower: { cloud: 0.4,  rain: 0.2,  snow: 0,   fog: 0,    thunder: false, wind: 1 },
    snow:      { cloud: 0.8,  rain: 0,    snow: 0.6, fog: 0.15, thunder: false, wind: 2 },
    fog:       { cloud: 0.5,  rain: 0,    snow: 0,   fog: 0.85, thunder: false, wind: 0.5 },
    thunder:   { cloud: 1,    rain: 0.7,  snow: 0,   fog: 0.1,  thunder: true,  wind: 4 }
  };
  function fromWmo(code, cloudCover, wind) {
    var w = { cloud: clamp((cloudCover || 0) / 100, 0, 1), rain: 0, snow: 0, fog: 0, thunder: false, wind: wind || 0 };
    if (code === 45 || code === 48) { w.fog = 0.85; w.cloud = Math.max(w.cloud, 0.5); }
    else if (code >= 51 && code <= 57) { w.rain = 0.22; w.fog = 0.15; }
    else if (code >= 61 && code <= 67) { w.rain = code === 65 ? 0.8 : code === 67 ? 0.6 : code === 63 ? 0.55 : 0.4; w.fog = 0.2; }
    else if (code >= 71 && code <= 77) w.snow = code === 75 ? 0.9 : 0.6;
    else if (code >= 80 && code <= 82) { w.rain = [0.5, 0.65, 0.85][code - 80]; w.fog = 0.1; }
    else if (code === 85 || code === 86) w.snow = 0.7;
    else if (code >= 95) { w.rain = 0.7; w.thunder = true; }
    if (w.rain || w.snow) w.cloud = Math.max(w.cloud, 0.8);
    return w;
  }
  function fetchWeather(lat, lon) { // Open-Meteo (キー不要)。15分キャッシュ
    var key = 'utsuroi-weather:' + lat.toFixed(2) + ',' + lon.toFixed(2);
    try { var c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 15 * 60e3) return Promise.resolve(c.w); } catch (e) { }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=weather_code,cloud_cover,wind_speed_10m&wind_speed_unit=ms&timezone=auto';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var w = fromWmo(j.current.weather_code, j.current.cloud_cover, j.current.wind_speed_10m);
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), w: w })); } catch (e) { }
      return w;
    });
  }
  /** 地名 → 緯度経度 (Open-Meteo の地名検索。キー不要・世界中)。'auto' はブラウザの現在地 (位置情報の許可が必要) */
  function geocode(place, lang) {
    if (place === 'auto') return new Promise(function (ok, ng) {
      if (!navigator.geolocation) return ng(new Error('geolocation unavailable'));
      navigator.geolocation.getCurrentPosition(function (p) { ok({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'current location' }); }, ng, { maximumAge: 3600e3, timeout: 10e3 });
    });
    var key = 'utsuroi-geo:' + place;
    try { var c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return Promise.resolve(c); } catch (e) { }
    // 正式名称で照合されるので、日本語の地名は「〜市」「〜都」なども同時に探し、人口がいちばん多い場所を選ぶ (例: 神戸 → 神戸市)
    var cjk = /[\u3040-\u30ff\u3400-\u9fff]/.test(place), names = [place];
    if (cjk && !/[市都府県区町村]$/.test(place)) names = names.concat(['市', '都', '府', '県', '区'].map(function (x) { return place + x; }));
    var search = function (q) {
      return fetch('https://geocoding-api.open-meteo.com/v1/search?count=10&format=json&language=' + (lang || (cjk ? 'ja' : 'en')) + '&name=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); }).then(function (j) { return j.results || []; }).catch(function () { return []; });
    };
    var save = function (res) { try { localStorage.setItem(key, JSON.stringify(res)); } catch (e) { } return res; };
    return Promise.all(names.map(search)).then(function (lists) {
      var all = [].concat.apply([], lists);
      if (all.length) {
        all.sort(function (a, b) { return (b.population || 0) - (a.population || 0); });
        var g = all[0]; return save({ lat: g.latitude, lon: g.longitude, name: g.name, country: g.country, timezone: g.timezone });
      }
      // 見つからない時は OpenStreetMap の地名検索で補う (結果は保存して、同じ地名を繰り返し問い合わせない)
      return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=' + (cjk ? 'ja' : 'en') + '&q=' + encodeURIComponent(place))
        .then(function (r) { return r.json(); }).then(function (j) {
          if (!j || !j[0]) throw new Error('place not found: ' + place);
          return save({ lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name.split(',')[0], country: '' });
        });
    });
  }
  function resolveWeather(w) {
    if (typeof w === 'string') return Object.assign({}, PRESETS[w] || PRESETS.clear);
    if (w && typeof w === 'object') return Object.assign({}, PRESETS.clear, w);
    return Object.assign({}, PRESETS.clear);
  }

  // 空マスクの自動補正: 粗いマスク(AI生成など)を目安に、画像そのものの色から空と地上の境を引き直す。
  // 絵ごとに輪郭が微妙にずれても、各画像にぴったり合った空マスクが得られる。
  function boxBlur(src, w, h, r) { // 分離型ボックスブラー (端はクランプ)
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, acc, n = 2 * r + 1;
    for (y = 0; y < h; y++) {
      acc = 0; for (k = -r; k <= r; k++) acc += src[y * w + clamp(k, 0, w - 1)];
      for (x = 0; x < w; x++) { tmp[y * w + x] = acc / n; acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      acc = 0; for (k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
      for (y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    return out;
  }
  function refineSky(img, coarse, outW) {
    try {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, w = outW || 768, h = Math.round(w * ih / iw), n = w * h, i, x, y, k, d;
      var c = canvas(w, h), cx = c.getContext('2d'); cx.drawImage(img, 0, 0, w, h); var px = cx.getImageData(0, 0, w, h).data;
      var mc = canvas(w, h), mx = mc.getContext('2d'); mx.drawImage(coarse, 0, 0, w, h); var md = mx.getImageData(0, 0, w, h).data;
      var C = new Float32Array(n); for (i = 0; i < n; i++) C[i] = md[i * 4 + 3] / 255;
      var R = Math.max(6, Math.round(w / 55)), B = boxBlur(C, w, h, R), D = 2 * R + 6, A = new Float32Array(n);
      var DX = [0, 0, -1, 1], DY = [-1, 1, 0, 0];
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x; var b = B[i];
        if (b >= 0.98) { A[i] = 1; continue; }
        if (b <= 0.02) { A[i] = 0; continue; }
        var sd = 1e9, gd = 1e9, si = -1, gi = -1;
        for (d = 0; d < 4; d++) for (k = 1; k <= D; k++) {
          var xx = x + DX[d] * k, yy = y + DY[d] * k; if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
          var j = yy * w + xx, bj = B[j];
          if (bj >= 0.98) { if (k < sd) { sd = k; si = j; } break; }
          if (bj <= 0.02) { if (k < gd) { gd = k; gi = j; } break; }
        }
        if (si < 0 || gi < 0) { A[i] = C[i]; continue; }
        var sr = px[si * 4], sg = px[si * 4 + 1], sb = px[si * 4 + 2], gr = px[gi * 4], gg = px[gi * 4 + 1], gb = px[gi * 4 + 2];
        var contrast = Math.sqrt((sr - gr) * (sr - gr) + (sg - gg) * (sg - gg) + (sb - gb) * (sb - gb));
        if (contrast < 20) { A[i] = C[i]; continue; } // 空と地上が溶け合っている所は目安のまま (境が見えないので困らない)
        var pr = px[i * 4], pg = px[i * 4 + 1], pb = px[i * 4 + 2];
        var dS = Math.sqrt((pr - sr) * (pr - sr) + (pg - sg) * (pg - sg) + (pb - sb) * (pb - sb));
        var dG = Math.sqrt((pr - gr) * (pr - gr) + (pg - gg) * (pg - gg) + (pb - gb) * (pb - gb));
        A[i] = smooth(0.38, 0.62, dG / (dS + dG + 1e-3));
      }
      var F = boxBlur(A, w, h, 2), oc = canvas(w, h), ox = oc.getContext('2d'), od = ox.createImageData(w, h);
      for (i = 0; i < n; i++) { od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = 255; od.data[i * 4 + 3] = smooth(0.3, 0.7, F[i]) * 255; } // 星などの孤立点をならし、縁をなめらかに
      ox.putImageData(od, 0, 0); return oc;
    } catch (e) { return null; } // CORS などで画素が読めない時は null (粗いマスクにフォールバック)
  }
  // ------------------------------------------------------------------ スプライト
  function softSprite(size, col, a) { var c = canvas(size, size), x = c.getContext('2d'); glow(x, size / 2, size / 2, size / 2, col, [[0, a], [0.5, a * 0.45], [1, 0]]); return c; }

  // 月: 球体として陰影をつけて描く (満ち欠けを terminator で表現)
  var MARIA = [[-0.30, 0.50, 0.30, 0.40], [0.12, 0.45, 0.17, 0.34], [0.30, 0.18, 0.20, 0.36], [0.68, 0.34, 0.10, 0.32], [-0.62, 0.10, 0.34, 0.30],
    [-0.22, -0.38, 0.19, 0.30], [0.52, -0.12, 0.14, 0.26], [-0.52, -0.40, 0.11, 0.30], [0.0, 0.0, 0.16, 0.14]];
  function renderMoon(ph, earth, flip) {
    var S = 160, c = canvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), p = img.data;
    var a = ph * TAU, Lx = Math.sin(a) * (flip ? -1 : 1), Lz = -Math.cos(a); // 光の向き (新月は背後、満月は正面)
    for (var j = 0; j < S; j++) for (var i = 0; i < S; i++) {
      var X = (i + 0.5) / S * 2 - 1, Y = 1 - (j + 0.5) / S * 2, d2 = X * X + Y * Y;
      if (d2 >= 1.02) continue;
      var d = Math.sqrt(d2), cover = clamp((1 - d) * S * 0.5, 0, 1), Z = Math.sqrt(Math.max(0, 1 - d2));
      var A = 0.97, m;
      for (m = 0; m < MARIA.length; m++) { var q = MARIA[m], dx = X - q[0], dy = Y - q[1]; A -= q[3] * Math.exp(-(dx * dx + dy * dy) / (q[2] * q[2])); }
      var ty = Y + 0.78, tx = X + 0.1; A += 0.16 * Math.exp(-(tx * tx + ty * ty) / 0.012); // ティコ
      A += 0.035 * Math.sin(X * 9 + Y * 7) * Math.sin(X * 13 - Y * 5);                       // 細かなむら
      A = clamp(A, 0.42, 1.05);
      var lit = X * Lx + Z * Lz, s = smooth(-0.05, 0.24, lit);
      var k = 4 * (j * S + i), lum = A * (0.78 + 0.22 * Z);
      var rr = lerp(80 * A, 255 * lum, s), gg = lerp(95 * A, 249 * lum, s), bb = lerp(130 * A, 232 * lum, s); // 暗部は地球照の青灰色
      p[k] = rr; p[k + 1] = gg; p[k + 2] = bb; p[k + 3] = 255 * cover * clamp(s + earth, 0, 1);
    }
    x.putImageData(img, 0, 0); return c;
  }

  // 落ち葉・花びらのスプライト: 葉脈・軸・色のグラデーション付き
  function leafSprite(kind, col) {
    var S = 88, c = canvas(S, S), x = c.getContext('2d'), R = S * 0.38, dark = mix3(col, [38, 10, 4], 0.5), light = mix3(col, [255, 236, 170], 0.38), i;
    x.translate(S / 2, S / 2 + 2); x.beginPath();
    if (kind === 'maple') { // 楓: 5つの尖り + 細かな鋸歯
      for (i = 0; i <= 160; i++) {
        var phi = -Math.PI + i / 160 * TAU, lobe = Math.pow(Math.abs(Math.cos(2.5 * phi)), 2.4), side = Math.abs(phi) > 2 ? 0.6 : 1;
        var r = R * (0.30 + 0.72 * lobe * side) * (1 + 0.05 * Math.sin(phi * 42)), px = Math.sin(phi) * r, py = -Math.cos(phi) * r;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
      }
    } else if (kind === 'ginkgo') { // 銀杏: 扇形 + 中央の切れ込み
      x.moveTo(0, R * 0.8); x.bezierCurveTo(-R * 0.2, R * 0.2, -R * 1.1, 0, -R * 1.0, -R * 0.5); x.quadraticCurveTo(-R * 0.5, -R * 0.98, -R * 0.05, -R * 0.6);
      x.quadraticCurveTo(R * 0.5, -R * 0.98, R * 1.0, -R * 0.5); x.bezierCurveTo(R * 1.1, 0, R * 0.2, R * 0.2, 0, R * 0.8);
    } else { // 楕円の葉
      x.moveTo(0, -R); x.bezierCurveTo(R * 0.8, -R * 0.4, R * 0.62, R * 0.5, 0, R * 0.95); x.bezierCurveTo(-R * 0.62, R * 0.5, -R * 0.8, -R * 0.4, 0, -R);
    }
    x.closePath();
    var g = x.createRadialGradient(0, -R * 0.25, 0, 0, 0, R * 1.15);
    g.addColorStop(0, rgba(light, 1)); g.addColorStop(0.55, rgba(col, 1)); g.addColorStop(1, rgba(dark, 1));
    x.fillStyle = g; x.fill(); x.lineWidth = 1.2; x.strokeStyle = rgba(dark, 0.7); x.stroke();
    x.strokeStyle = rgba(dark, 0.55); x.lineWidth = 1.1; x.lineCap = 'round'; x.beginPath();
    if (kind === 'maple') {
      [0, 0.4, -0.4, 0.8, -0.8].forEach(function (k) { var ph = k * Math.PI, sd = Math.abs(ph) > 2 ? 0.6 : 1; x.moveTo(0, R * 0.12); x.lineTo(Math.sin(ph) * R * 0.86 * sd, -Math.cos(ph) * R * 0.86 * sd); });
      x.moveTo(0, R * 0.12); x.lineTo(0, R * 0.95 + 8);
    } else if (kind === 'ginkgo') {
      for (i = -4; i <= 4; i++) { x.moveTo(0, R * 0.78); x.lineTo(i * R * 0.24, -R * 0.74 + Math.abs(i) * R * 0.05); }
      x.moveTo(0, R * 0.78); x.lineTo(0, R * 0.78 + 8);
    } else {
      x.moveTo(0, -R * 0.92); x.lineTo(0, R * 0.95 + 6);
      for (i = -2; i <= 2; i++) if (i) { var yy = i * R * 0.28; x.moveTo(0, yy); x.lineTo(R * 0.4, yy - R * 0.22); x.moveTo(0, yy); x.lineTo(-R * 0.4, yy - R * 0.22); }
    }
    x.stroke(); return c;
  }
  function petalSprite(col) { // 桜の花びら: 先に切れ込み
    var S = 44, c = canvas(S, S), x = c.getContext('2d'), R = S * 0.42;
    x.translate(S / 2, S / 2); x.beginPath();
    x.moveTo(0, R * 0.9); x.bezierCurveTo(-R * 0.95, R * 0.35, -R * 0.85, -R * 0.85, -R * 0.2, -R * 0.92); x.lineTo(0, -R * 0.6); x.lineTo(R * 0.2, -R * 0.92);
    x.bezierCurveTo(R * 0.85, -R * 0.85, R * 0.95, R * 0.35, 0, R * 0.9); x.closePath();
    var g = x.createRadialGradient(0, R * 0.7, 0, 0, 0, R * 1.2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, rgba(col, 1)); g.addColorStop(1, rgba(mix3(col, [230, 120, 150], 0.4), 1));
    x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(210,110,140,0.35)'; x.lineWidth = 1; x.stroke();
    x.beginPath(); x.moveTo(0, R * 0.8); x.lineTo(0, -R * 0.3); x.stroke(); return c;
  }

  // 雲: 継ぎ目のない「ドメインワープ + billow/fBm(7オクターブ)」のフラクタル密度場を一度だけ作り、
  // 積雲スプライトと曇天の層の両方をそこから切り出す。光が当たる縁/影になる側は密度の勾配で付ける。
  var FW = 512, FH = 256, FIELD = null;
  function buildField() {
    var r = rng(41), OCT = 7, lat = [], o, i, x, y;
    for (o = 0; o < OCT; o++) { var gx = 4 << o, gy = 2 << o, L = new Float32Array(gx * gy); for (i = 0; i < L.length; i++) L[i] = r(); lat.push({ gx: gx, gy: gy, L: L }); }
    function vn(o, x, y) { // 周期境界つきの値ノイズ
      var q = lat[o], fx = x / FW * q.gx, fy = y / FH * q.gy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      var xa = ((x0 % q.gx) + q.gx) % q.gx, xb = (xa + 1) % q.gx, ya = ((y0 % q.gy) + q.gy) % q.gy, yb = (ya + 1) % q.gy;
      return lerp(lerp(q.L[ya * q.gx + xa], q.L[ya * q.gx + xb], tx), lerp(q.L[yb * q.gx + xa], q.L[yb * q.gx + xb], tx), ty);
    }
    var V = new Float32Array(FW * FH), S = new Float32Array(FW * FH), sum = 0, sq = 0;
    for (y = 0; y < FH; y++) for (x = 0; x < FW; x++) {
      var w1 = vn(0, x + 11, y + 5) * 0.6 + vn(1, x + 40, y + 70) * 0.4, w2 = vn(0, x + 200, y + 90) * 0.6 + vn(1, x + 15, y + 150) * 0.4;
      var fx = x + (w1 - 0.5) * 70, fy = y + (w2 - 0.5) * 34, a = 1, tot = 0, bil = 0, pl = 0;
      for (o = 0; o < OCT; o++) { var n = vn(o, fx, fy); bil += a * (1 - Math.abs(2 * n - 1)); pl += a * n; tot += a; a *= 0.52; }
      var v = (0.62 * bil + 0.38 * pl) / tot; V[y * FW + x] = v; sum += v; sq += v * v;
    }
    var m = sum / V.length, sd = Math.sqrt(sq / V.length - m * m) || 0.1;
    for (i = 0; i < V.length; i++) V[i] = clamp(0.5 + (V[i] - m) / (5 * sd), 0, 1); // 0..1 に正規化
    for (y = 0; y < FH; y++) for (x = 0; x < FW; x++) // 光(左上)側の密度が低い縁 = 明るい
      S[y * FW + x] = V[y * FW + x] - V[((y - 4 + FH) % FH) * FW + (x - 3 + FW) % FW];
    return { V: V, S: S };
  }
  function ensureField() { if (!FIELD) FIELD = buildField(); return FIELD; }
  function fieldAt(A, x, y) { // 双一次補間 (周期)
    var x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    x0 = ((x0 % FW) + FW) % FW; y0 = ((y0 % FH) + FH) % FH; var x1 = (x0 + 1) % FW, y1 = (y0 + 1) % FH;
    return lerp(lerp(A[y0 * FW + x0], A[y0 * FW + x1], tx), lerp(A[y1 * FW + x0], A[y1 * FW + x1], tx), ty);
  }
  function overcastTexture(cv, cov, dark) { // cov 0..1 = 雲に覆われる割合, dark 0..1 = 雨雲の暗さ
    var F = ensureField(), x = cv.getContext('2d'), img = x.createImageData(FW, FH), p = img.data, lo = 0.86 - cov * 0.8, i;
    var lightC = mix3([246, 248, 252], [204, 208, 218], dark), shadeC = mix3([134, 146, 170], [84, 92, 110], dark);
    for (i = 0; i < F.V.length; i++) {
      var v = F.V[i], a = smooth(lo, lo + 0.2, v), lit = clamp(0.5 + F.S[i] * 3.2, 0, 1), thick = smooth(0.55, 0.9, v);
      var t = clamp(lit * 0.75 + (1 - thick) * 0.4, 0, 1), col = mix3(shadeC, lightC, t), k = i * 4; // 厚い所は暗く、光を受ける縁は明るい
      p[k] = col[0]; p[k + 1] = col[1]; p[k + 2] = col[2]; p[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ レンダラー
  var AMBIENT = { spring: { n: 54, kind: 'petal', when: 'day' }, summer: { n: 36, kind: 'firefly', when: 'night' }, autumn: { n: 46, kind: 'leaf', when: 'day' }, winter: { n: 0 } };

  function Renderer(opts) {
    this.o = Object.assign({ lat: 34.69, lon: 135.19, horizon: 0.55, top: 0.08, spanDeg: 110, celestial: true, ambient: true, glass: true, ripples: true }, clean(opts));
    this.W = 2; this.H = 2; this.rect = { x: 0, y: 0, w: 2, h: 2 };
    this.sky = canvas(2, 2); this.lt = canvas(2, 2); this.bd = canvas(2, 2); this.cl = canvas(2, 2);
    this.mask = null; this.matte = null;
    this.w = resolveWeather('clear'); this.wt = resolveWeather('clear');
    this.moonCache = {}; this.moonKeys = []; this.mt = canvas(160, 160);
    this.flash = 0; this.nextFlash = 6; this.bolt = null; this.shoot = null; this.nextShoot = 8;
    this.ripples = []; this.rippleAcc = 0;
    var r = rng(7), i;
    this.stars = []; for (i = 0; i < 280; i++) this.stars.push({ x: r(), y: r(), b: 0.3 + r() * 0.7, s: 0.5 + r() * 1.2, sp: 0.5 + r() * 2, ph: r() * 6, c: r() });
    this.over = canvas(FW, FH); this.overCov = -1; this.overDark = -1;
    this.hazeA = canvas(2, 2); this.hazeB = canvas(2, 2); this.haze = canvas(2, 2);
    this.fogSprite = canvas(512, 128); glow(this.fogSprite.getContext('2d'), 256, 64, 256, [255, 255, 255], [[0, 0.7], [0.55, 0.28], [1, 0]]); // 丸い光のスプライト (使う時に縦に伸ばす)
    this.fogBands = []; for (i = 0; i < 5; i++) this.fogBands.push({ x: r(), y: r(), s: 0.7 + r() * 0.8, sp: 0.4 + r() * 0.8 });
    this.flake = softSprite(48, [255, 255, 255], 0.95);
    this.leaves = [leafSprite('maple', [196, 44, 30]), leafSprite('maple', [226, 118, 30]), leafSprite('maple', [214, 160, 36]), leafSprite('ginkgo', [232, 192, 52]), leafSprite('oval', [176, 100, 40]), leafSprite('maple', [160, 60, 34])];
    this.petals = [petalSprite([255, 214, 226]), petalSprite([255, 228, 236]), petalSprite([250, 196, 214])];
    this.water = null; this.gl = canvas(2, 2); this.glit = [];
    this.glSprites = (function () { // 波頭の反射(横長の細い光) / 小さな点
      var dash = canvas(64, 16), dx = dash.getContext('2d'), dot = canvas(32, 32), tx = dot.getContext('2d');
      dx.save(); dx.translate(32, 8); dx.scale(1, 0.2); glow(dx, 0, 0, 32, [255, 255, 255], [[0, 1], [0.45, 0.5], [1, 0]]); dx.restore();
      glow(tx, 16, 16, 16, [255, 255, 255], [[0, 1], [0.3, 0.45], [1, 0]]);
      return [dash, dot];
    })();
    // 固定の波面(ファセット)。遠いほど細かく密、近いほど大きく疎。それぞれ自分のリズムで短く光る
    var rr = rng(99); for (i = 0; i < 1500; i++) { var tt = Math.pow(rr(), 1.8); this.glit.push({ u: rr(), t: tt, ph: rr() * 6.283, sp: 0.5 + rr() * 1.1, type: rr() < 0.8 ? 0 : 1, size: 0.6 + rr() * 0.8, pr: rr() }); }
    this.pool = { rain: [], flakes: [], amb: [], glass: [] };
    for (i = 0; i < 470; i++) this.pool.rain.push({ x: r(), y: r(), ph: r() * 6 });
    for (i = 0; i < 420; i++) this.pool.flakes.push({ x: r(), y: r(), ph: r() * 6, v: 0.7 + r() * 0.6 });
    for (i = 0; i < 120; i++) this.pool.amb.push({ x: r(), y: r(), s: 0.5 + r(), v: 0.5 + r(), ph: r() * 6, c: r() });
    for (i = 0; i < 24; i++) this.pool.glass.push({ x: r(), y: r() * 0.6, y0: 0, r: 3 + r() * 6, age: r() * 12, T: 7 + r() * 7, v: 0, slideAt: 0.3, wob: r() * 6 });
  }
  var R = Renderer.prototype;

  R.resize = function (W, H, rect) {
    this.W = W; this.H = H;
    [this.sky, this.lt, this.bd, this.cl, this.haze].forEach(function (c) { c.width = W; c.height = H; });
    this._hazeOk = false;
    this.gl.width = W; this.gl.height = H;
    this.rect = rect || { x: 0, y: 0, w: W, h: H };
  };
  R.setGlass = function (box, scale) { this.glassBox = box || null; this.glassScale = scale || 1; };   // 窓ガラスの範囲(px)。遠い窓では水滴をその中だけに小さく出す
  R.setWater = function (img) { this.water = img || null; };   // 水面マスク (アルファ=水面)。海・湖・川のきらめきをその中だけに描く
  R.setSkyMask = function (c) { this.mask = c; };       // W×H の canvas。アルファ=空
  R.setCloudMatte = function (c) { this.matte = c; };   // W×H の canvas。アルファ=雲の濃さ (天体を雲の後ろに回す)
  R.setWeather = function (w) { this.wt = resolveWeather(w); };
  R.info = function (date) {
    var c = celestial(date, this.o.lat, this.o.lon);
    return { sun: c.sun, moon: c.moon, phase: c.phase, moonInfo: moonInfo(date), sunTimes: sunTimes(date, this.o.lat, this.o.lon) };
  };
  R._pos = function (b) { // 方位・高度 → 画面座標
    var r = this.rect, o = this.o;
    return { x: r.x + (0.5 + clamp(b.az, -180, 180) / o.spanDeg * 0.45) * r.w, y: r.y + (o.horizon - clamp(b.alt / 72, -0.4, 1) * (o.horizon - o.top)) * r.h };
  };

  /** ctx にはすでに背景(シーン)が描かれている前提で、その上に空と天気を重ねる */
  R.render = function (ctx, st) {
    var o = this.o, wx = this.w, sec = st.t || 0, dt = Math.min(0.1, st.dt || 0.033), date = st.date || new Date();
    var rate = { cloud: 0.5, rain: 0.3, snow: 0.4, fog: 0.35, wind: 0.5 };
    for (var k in rate) wx[k] += (this.wt[k] - wx[k]) * Math.min(1, dt * rate[k]);
    wx.thunder = this.wt.thunder;
    this.drift = (this.drift || 0) + dt * (1 + wx.wind * 0.4); // 風速を積算 (風が変わっても雲の位置は飛ばない)

    var cel = celestial(date, o.lat, o.lon), alt = cel.sun.alt;
    var night = 1 - smooth(-16, -5, alt), day = smooth(-4, 8, alt), twi = smooth(-14, -3, alt) * (1 - smooth(-1, 9, alt));
    var env = { cel: cel, alt: alt, night: night, day: day, twi: twi, sec: sec, dt: dt, wx: wx };

    this._grade(ctx, env);
    this._skyLayers(ctx, env);
    this._glitter(ctx, env);
    this._rays(ctx, env);
    this._fog(ctx, env);
    if (o.ambient && st.seasons) this._ambient(ctx, env, st.seasons);
    this._rain(ctx, env);
    this._snow(ctx, env);
    this._glass(ctx, env);
    if (wx.thunder) this._flashGlobal(ctx, env);
    return { sun: cel.sun, moon: cel.moon, phase: cel.phase, night: night, day: day, twilight: twi };
  };

  // --- 全体の色調: 雲・雨・霧で彩度を落とし、冷たい青灰色に寄せる
  R._grade = function (ctx, e) {
    var wx = e.wx, W = this.W, H = this.H;
    var k = clamp(wx.cloud * 0.32 + wx.rain * 0.3 + wx.fog * 0.25 + wx.snow * 0.1, 0, 0.72);
    if (k < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = k; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    var dim = (wx.cloud * 0.12 + wx.rain * 0.14) * (0.35 + 0.65 * e.day);
    ctx.fillStyle = rgba([58, 76, 108], dim); ctx.fillRect(0, 0, W, H);
    if (wx.rain > 0.05) { // しっとりした周辺減光
      var vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(20,30,50,0)'); vg.addColorStop(1, rgba([20, 30, 52], wx.rain * 0.38));
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  };

  // --- 空レイヤー: 光(加算) と 実体(通常合成) を空マスクの内側にだけ描く
  R._skyLayers = function (ctx, e) {
    var W = this.W, H = this.H, o = this.o, wx = e.wx, s = this.sky.getContext('2d'), lt = this.lt.getContext('2d'), bd = this.bd.getContext('2d');
    s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.clearRect(0, 0, W, H);
    lt.globalCompositeOperation = 'source-over'; lt.globalAlpha = 1; lt.clearRect(0, 0, W, H);
    bd.globalCompositeOperation = 'source-over'; bd.globalAlpha = 1; bd.clearRect(0, 0, W, H);
    lt.globalCompositeOperation = 'lighter';

    if (o.celestial) {
      this._stars(s, e);
      this._dawnGlow(lt, e);
      this._sun(lt, bd, e);
      this._moon(lt, bd, e);
    }
    this._rainbow(lt, e);
    // 画像側の雲マットで、天体を雲の後ろへ (光は薄く透過、円盤は隠れる)
    if (this.matte) {
      this._occlude(s, 0.85); this._occlude(lt, 0.4); this._occlude(bd, 0.98);
    }
    s.drawImage(this.bd, 0, 0);          // 太陽・月の円盤
    this._clouds(s, e);                  // 動く雲 (円盤の手前)
    this._lightning(s, e);

    var mk = this.mask;
    if (mk) { lt.globalCompositeOperation = 'destination-in'; lt.drawImage(mk, 0, 0); s.globalCompositeOperation = 'destination-in'; s.drawImage(mk, 0, 0); }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(this.lt, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(this.sky, 0, 0);
    ctx.restore();
  };
  R._occlude = function (g, k) { g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = k; g.drawImage(this.matte, 0, 0); g.restore(); };

  R._stars = function (s, e) {
    var wx = e.wx, a0 = e.night * (1 - wx.cloud * 0.85) * (1 - wx.fog * 0.6), r = this.rect, hy = this.o.horizon, u = Math.max(1, this.W / 1000), i;
    if (a0 > 0.02) {
      if (!this.starSprites) { // 丸くやわらかい光の点 (白・青白・橙)。またたかせない
        this.starSprites = [[255, 255, 255], [190, 212, 255], [255, 218, 180]].map(function (c) { var cv = canvas(16, 16); glow(cv.getContext('2d'), 8, 8, 8, c, [[0, 1], [0.25, 0.7], [0.6, 0.12], [1, 0]]); return cv; });
      }
      s.save(); s.globalCompositeOperation = 'lighter';
      for (i = 0; i < this.stars.length; i++) {
        var st = this.stars[i], sz = (1.6 + st.s * 1.6 * (st.b > 0.85 ? 1.5 : 1)) * u;
        s.globalAlpha = a0 * st.b * 0.9;
        s.drawImage(this.starSprites[st.c < 0.2 ? 2 : st.c > 0.8 ? 1 : 0], r.x + st.x * r.w - sz / 2, r.y + st.y * hy * r.h - sz / 2, sz, sz);
      }
      s.restore(); s.globalAlpha = 1;
    }
    // ときどき流れ星
    if (a0 > 0.5) {
      this.nextShoot -= e.dt;
      if (this.nextShoot < 0 && !this.shoot) { this.shoot = { x: 0.15 + Math.random() * 0.7, y: Math.random() * 0.3, a: 0.35 + Math.random() * 0.4, t: 0 }; this.nextShoot = 18 + Math.random() * 30; }
    }
    if (this.shoot) {
      var sh = this.shoot; sh.t += e.dt / 0.8;
      if (sh.t >= 1) this.shoot = null;
      else {
        var L = r.w * 0.14, x0 = r.x + sh.x * r.w + Math.cos(sh.a) * L * sh.t * 1.4, y0 = r.y + sh.y * r.h + Math.sin(sh.a) * L * sh.t * 1.4;
        var tx = x0 - Math.cos(sh.a) * L * 0.6, ty = y0 - Math.sin(sh.a) * L * 0.6, g = s.createLinearGradient(x0, y0, tx, ty), fa = Math.sin(sh.t * Math.PI) * a0;
        g.addColorStop(0, 'rgba(255,255,255,' + fa.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        s.strokeStyle = g; s.lineWidth = u * 1.4; s.lineCap = 'round'; s.beginPath(); s.moveTo(x0, y0); s.lineTo(tx, ty); s.stroke();
      }
    }
  };

  R._dawnGlow = function (lt, e) {
    var k = e.twi; if (k < 0.01) return;
    var p = this._pos({ az: e.cel.sun.az, alt: 0 }), r = this.rect, col = e.cel.sun.morning ? [255, 150, 120] : [255, 125, 75], a = 0.5 * k * (1 - 0.6 * e.wx.cloud);
    lt.save(); lt.translate(p.x, p.y); lt.scale(1, 0.45); glow(lt, 0, 0, r.w * 0.6, col, [[0, a], [0.4, a * 0.4], [1, 0]]); lt.restore();
  };

  R._sun = function (lt, bd, e) {
    var alt = e.alt, wx = e.wx; if (alt < -9) return;
    var p = this._pos(e.cel.sun), r = this.rect, low = 1 - smooth(0, 25, alt), ext = 1 - smooth(-1, 22, alt);
    var rad = r.w * 0.016 * (1 + 0.3 * low), col = mix3([255, 247, 228], [255, 105, 38], ext);
    var vis = (1 - wx.cloud * 0.85) * (1 - wx.fog * 0.5) * smooth(-9, -3, alt);
    if (vis < 0.01) return;
    // コロナ・ブルーム (多段)
    glow(lt, p.x, p.y, rad * 2.2, col, [[0, 0.55 * vis], [1, 0]]);
    glow(lt, p.x, p.y, rad * 6, col, [[0, 0.2 * vis], [0.3, 0.07 * vis], [1, 0]]);
    glow(lt, p.x, p.y, rad * 16, col, [[0, 0.07 * vis], [0.4, 0.02 * vis], [1, 0]]);
    if (low > 0.3) glow(lt, p.x, p.y, r.w * 0.7, mix3(col, [255, 190, 130], 0.5), [[0, 0.05 * vis * low], [1, 0]]); // 低い時だけ空を染める
    // 低い太陽の横長の光芒 (アナモルフィック)
    var streak = (1 - smooth(8, 16, alt)) * smooth(-3, 1, alt);
    if (streak > 0.02) { lt.save(); lt.translate(p.x, p.y); lt.scale(1, 0.035); glow(lt, 0, 0, r.w * 0.5, col, [[0, 0.22 * vis * streak], [1, 0]]); lt.restore(); }
    // 円盤: 中心は白熱、縁は大気で色づき、輪郭はやわらかく
    bd.save(); bd.translate(p.x, p.y); bd.scale(1, 1 - 0.08 * low); bd.globalAlpha = vis;
    var gd = bd.createRadialGradient(0, 0, 0, 0, 0, rad * 1.08);
    gd.addColorStop(0, 'rgba(255,255,252,1)'); gd.addColorStop(0.7, rgba(mix3(col, [255, 255, 255], 0.6), 1));
    gd.addColorStop(0.92, rgba(mix3(col, [255, 255, 255], 0.15), 0.95)); gd.addColorStop(1, rgba(col, 0));
    bd.fillStyle = gd; bd.fillRect(-rad * 1.2, -rad * 1.2, rad * 2.4, rad * 2.4); bd.restore();
  };

  R._moonSprite = function (ph, earth, flip) {
    var key = Math.round(ph * 300) + (earth ? 'e' : 'd') + (flip ? 'f' : ''), c = this.moonCache[key];
    if (!c) {
      c = this.moonCache[key] = renderMoon(ph, earth ? 0.07 : 0, flip); this.moonKeys.push(key);
      if (this.moonKeys.length > 8) delete this.moonCache[this.moonKeys.shift()];
    }
    return c;
  };
  R._moon = function (lt, bd, e) {
    var m = e.cel.moon, wx = e.wx; if (m.alt < -5) return;
    var p = this._pos(m), r = this.rect, ph = e.cel.phase, low = 1 - smooth(0, 30, m.alt);
    var rad = r.w * 0.019 * (1 + 0.22 * low), illum = (1 - Math.cos(ph * TAU)) / 2;
    var vis = (1 - wx.cloud * 0.9) * (1 - wx.fog * 0.5) * smooth(-5, 1, m.alt) * (1 - smooth(0.25, 0.75, e.day)); // 昼は月を出さない (薄明・夜だけ)
    if (vis < 0.01) return;
    var halo = [200, 218, 255];
    glow(lt, p.x, p.y, rad * 5, halo, [[0, 0.3 * illum * vis * (0.2 + 0.8 * e.night)], [1, 0]]);
    glow(lt, p.x, p.y, rad * 16, halo, [[0, 0.1 * illum * vis * e.night], [1, 0]]);
    var ring = smooth(0.12, 0.35, wx.cloud) * (1 - smooth(0.6, 0.85, wx.cloud)) * e.night * illum; // 薄雲ごしの月暈
    if (ring > 0.02) { var rr = r.w * 0.2; glow(lt, p.x, p.y, rr * 1.15, halo, [[0, 0], [0.8, 0], [0.9, 0.09 * ring], [1, 0]]); }
    var spr = this._moonSprite(ph, e.night > 0.35, this.o.lat < 0);
    var mt = this.mt.getContext('2d'); mt.globalCompositeOperation = 'source-over'; mt.clearRect(0, 0, 160, 160); mt.drawImage(spr, 0, 0);
    if (low > 0.05) { mt.globalCompositeOperation = 'source-atop'; mt.fillStyle = rgba([255, 165, 100], 0.4 * low); mt.fillRect(0, 0, 160, 160); }
    bd.save(); bd.globalAlpha = vis; bd.drawImage(this.mt, p.x - rad * 1.02, p.y - rad * 1.02, rad * 2.04, rad * 2.04); bd.restore();
  };

  // --- 虹: 弱い雨と太陽が同時にある時だけ、太陽の反対側に
  R._rainbow = function (lt, e) {
    var wx = e.wx, alt = e.alt;
    var k = smooth(0.04, 0.12, wx.rain) * (1 - smooth(0.32, 0.5, wx.rain)) * (1 - smooth(0.4, 0.8, wx.cloud)) * smooth(2, 8, alt) * (1 - smooth(32, 42, alt));
    if (k < 0.02) return;
    var r = this.rect, o = this.o, sp = this._pos(e.cel.sun), cx = r.x + r.w - (sp.x - r.x), scaleY = (o.horizon - o.top) * r.h / 72;
    var cy = r.y + o.horizon * r.h + alt * scaleY, R0 = 42 * scaleY, bw = R0 * 0.02;
    var cols = [[255, 70, 70], [255, 150, 60], [255, 230, 80], [90, 210, 110], [80, 160, 255], [110, 90, 230], [170, 90, 220]];
    lt.save(); lt.lineWidth = bw * 1.1;
    for (var i = 0; i < cols.length; i++) { lt.strokeStyle = rgba(cols[i], 0.2 * k); lt.beginPath(); lt.arc(cx, cy, R0 - i * bw, Math.PI, 2 * Math.PI); lt.stroke(); }
    lt.restore();
  };

  // --- 動く雲: 雲量に応じて 点在する雲 → 空全体をおおう曇天 へ
  R._clouds = function (s, e) {
    var wx = e.wx, amt = wx.cloud; if (amt < 0.03) return;
    var cl = this.cl.getContext('2d'), r = this.rect, o = this.o, W = this.W, H = this.H, i, c, x, w, h;
    cl.globalCompositeOperation = 'source-over'; cl.globalAlpha = 1; cl.clearRect(0, 0, W, H);
    var drift = this.drift, sky0 = r.y, sky1 = r.y + r.h * o.horizon, t;
    if (amt > 0.35) { // 曇天: ノイズの雲の層 (切れ目なく空全体に。地形との境はマスクが決める)
      var cov = smooth(0.25, 0.8, amt), dark = clamp(e.wx.rain * 0.55 + e.wx.snow * 0.2, 0, 0.7);
      if (Math.abs(cov - this.overCov) > 0.008 || Math.abs(dark - this.overDark) > 0.01) { overcastTexture(this.over, cov, dark); this.overCov = cov; this.overDark = dark; this._op = null; }   // パターンは作成時点の内容を保持するので作り直す
      var tw = r.w * 1.5, th = (sky1 - sky0) * 1.15 + r.h * 0.2, off = ((drift * 0.0032) % 1) * tw, y0 = sky0 - r.h * 0.04;
      if (!this._op || this._opCtx !== cl) { this._op = cl.createPattern(this.over, 'repeat'); this._opCtx = cl; }   // 継ぎ目のない貼り方 (並べた端の縦線を防ぐ)
      cl.save(); cl.globalAlpha = 0.5 + 0.45 * cov; cl.translate(off - tw * 0.1, y0); cl.scale(tw / FW, th / FH); cl.fillStyle = this._op;
      cl.fillRect(-(off - tw * 0.1) * FW / tw, 0, W * FW / tw + 2 * FW, FH); cl.restore();
      // 水平線に向かって薄くなる (遠くの雲ほど霞む)。境の形は空マスクに従うので直線は出ない
      cl.globalCompositeOperation = 'destination-out';
      var fg = cl.createLinearGradient(0, sky0, 0, y0 + th); fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(0.6, 'rgba(0,0,0,0.05)'); fg.addColorStop(1, 'rgba(0,0,0,0.45)');
      cl.globalAlpha = 1; cl.fillStyle = fg; cl.fillRect(0, 0, W, H); cl.globalCompositeOperation = 'source-over';
    }
    cl.globalAlpha = 1; cl.globalCompositeOperation = 'source-atop';
    if (e.night > 0.02) { cl.fillStyle = rgba([22, 30, 52], 0.85 * e.night); cl.fillRect(0, 0, W, H); }
    if (e.twi > 0.02) { cl.fillStyle = rgba([255, 150, 110], 0.42 * e.twi); cl.fillRect(0, 0, W, H); }
    // 太陽・月の方向から縁を明るく (雲の裏から光が透ける)
    var src = e.alt > -4 ? e.cel.sun : e.cel.moon, lp = this._pos(src), lk = e.alt > -4 ? smooth(-4, 6, e.alt) * (1 - e.night) : e.night * 0.5;
    if (lk > 0.02 && o.celestial) { glow(cl, lp.x, lp.y, r.w * 0.38, e.alt > -4 ? [255, 226, 180] : [190, 205, 240], [[0, 0.55 * lk * (1 - e.wx.rain * 0.5)], [1, 0]]); } // source-atop のまま = 雲のある所だけ明るくなる
    cl.globalCompositeOperation = 'source-over';
    s.drawImage(this.cl, 0, 0);
  };

  R._lightning = function (s, e) {
    var wx = e.wx; if (!wx.thunder || wx.rain < 0.1) return;
    this.nextFlash -= e.dt;
    if (this.nextFlash < 0) {
      this.flash = 1; this.nextFlash = 7 + Math.random() * 14;
      if (Math.random() < 0.5) { // 遠雷ならシートライトニングだけ、近ければ稲妻も
        var r = this.rect, x = r.x + (0.15 + Math.random() * 0.7) * r.w, y = r.y + this.o.top * r.h, pts = [[x, y]], yy = y, hy = r.y + this.o.horizon * r.h;
        while (yy < hy) { yy += r.h * (0.03 + Math.random() * 0.04); x += (Math.random() - 0.5) * r.w * 0.04; pts.push([x, Math.min(yy, hy)]); }
        this.bolt = pts;
      } else this.bolt = null;
    }
    if (this.flash > 0.02) {
      s.save(); s.globalCompositeOperation = 'lighter'; s.fillStyle = 'rgba(205,218,255,' + (this.flash * 0.2).toFixed(3) + ')'; s.fillRect(0, 0, this.W, this.H);
      if (this.bolt && this.flash > 0.4) {
        s.strokeStyle = 'rgba(235,240,255,' + this.flash.toFixed(3) + ')'; s.lineWidth = Math.max(1, this.W / 700); s.shadowColor = 'rgba(180,200,255,0.9)'; s.shadowBlur = 14;
        s.beginPath(); s.moveTo(this.bolt[0][0], this.bolt[0][1]); for (var i = 1; i < this.bolt.length; i++) s.lineTo(this.bolt[i][0], this.bolt[i][1]); s.stroke();
      }
      s.restore(); this.flash *= 0.9;
    }
  };
  R._flashGlobal = function (ctx) { if (this.flash > 0.02) { ctx.fillStyle = 'rgba(225,232,255,' + (this.flash * 0.1).toFixed(3) + ')'; ctx.fillRect(0, 0, this.W, this.H); } };

  // --- 水面のきらめき: 波面が光を反射する短いチラつき。太陽(月)の真下に帯になり、遠いほど細かい
  R._glitter = function (ctx, e) {
    if (!this.water) return;
    var wx = e.wx, o = this.o, r = this.rect, W = this.W, H = this.H, u = Math.max(1, W / 1000);
    var dayB = smooth(-3, 12, e.alt) * (1 - wx.cloud * 0.6) * (1 - wx.fog * 0.6) * (1 - wx.rain * 0.8);
    var nightB = e.night * (o.glitterNight === false ? 0 : 0.35) * (1 - wx.cloud * 0.3) * (1 - wx.fog * 0.5);
    var m = e.cel.moon, moonB = m.alt > 2 ? (1 - Math.cos(e.cel.phase * TAU)) / 2 * e.night * (1 - wx.cloud * 0.8) * 0.7 : 0;
    var tot = Math.max(dayB, nightB, moonB); if (tot < 0.03) return;
    var useMoon = moonB > nightB && moonB > dayB, colX = (useMoon || dayB > 0.05) ? this._pos(useMoon ? m : e.cel.sun).x : null;
    var tint = dayB > 0.25 ? mix3([246, 250, 255], [255, 214, 166], e.twi) : (useMoon ? [214, 226, 255] : [255, 214, 156]);
    var g = this.gl.getContext('2d'), hz = o.horizon, sec = e.sec, i;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; var y0 = Math.max(0, Math.floor(r.y + hz * r.h)), hh = H - y0; g.clearRect(0, y0, W, hh); g.globalCompositeOperation = 'lighter';   // 水面は地平線より下だけ。処理もそこだけ
    for (i = 0; i < this.glit.length; i++) {
      var s = this.glit[i];
      var flash = Math.sin(sec * s.sp + s.ph); if (flash <= 0.3) continue;           // 波の向きが合った一瞬だけ光る
      var a = Math.pow((flash - 0.3) / 0.7, 2);
      var x = r.x + s.u * r.w + Math.sin(sec * 0.35 + s.ph) * 2 * u, y = r.y + (hz + 0.015 + s.t * (0.97 - hz - 0.015)) * r.h;
      var w = 0.12;                                                                    // 帯の外にもごくわずかに
      if (colX !== null) { var sig = r.w * (0.06 + 0.13 * s.t), dx = (x - colX) / sig; w += 0.88 * Math.exp(-dx * dx); }
      else w = 0.35;
      var k = a * w * tot * (0.55 + 0.45 * Math.sin(sec * 0.27 + s.pr * 40));          // ゆっくりした明暗のむら
      if (k < 0.02) continue;
      var sw = (3 + 18 * s.t) * u * s.size, spr = this.glSprites[s.type];
      g.globalAlpha = clamp(k * 0.75, 0, 0.6);
      if (s.type === 0) g.drawImage(spr, x - sw / 2, y - sw * 0.06, sw, sw * 0.25);
      else { var d = (1.6 + 3.2 * s.t) * u * s.size; g.drawImage(spr, x - d / 2, y - d / 2, d, d); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-atop'; g.fillStyle = rgba(tint, 0.75); g.fillRect(0, y0, W, hh);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(this.water, r.x, r.y, r.w, r.h);   // 水面の中だけ
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(this.gl, 0, y0, W, hh, 0, y0, W, hh); ctx.restore();
  };

  // --- 光芒 (雲の切れ間から差す光)
  R._rays = function (ctx, e) {
    var wx = e.wx, alt = e.alt, k = smooth(4, 14, alt) * smooth(0.12, 0.35, wx.cloud) * (1 - smooth(0.6, 0.9, wx.cloud)) * (1 - wx.rain * 0.5);
    if (k < 0.02 || !this.o.celestial) return;
    var p = this._pos(e.cel.sun), W = this.W, H = this.H, L = Math.hypot(W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 14; i++) {
      var ang = Math.PI / 2 + (i - 6.5) * 0.14 + Math.sin(e.sec * 0.07 + i) * 0.03, wd = 0.03 + (i % 3) * 0.015;
      var a = 0.03 * k * (0.55 + 0.45 * Math.sin(e.sec * 0.25 + i * 1.7));
      var g = ctx.createLinearGradient(p.x, p.y, p.x + Math.cos(ang) * L, p.y + Math.sin(ang) * L);
      g.addColorStop(0, rgba([255, 235, 200], a)); g.addColorStop(1, rgba([255, 235, 200], 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(ang - wd) * L, p.y + Math.sin(ang - wd) * L); ctx.lineTo(p.x + Math.cos(ang + wd) * L, p.y + Math.sin(ang + wd) * L); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  // --- 霧・もや: 水平線付近をゆっくり流れる
  R._buildHaze = function (col) { // 空マスクを二段階にぼかして色を付ける (低解像度を経由するので軽い)
    var W = this.W, H = this.H, ta = this.hazeA, tb = this.hazeB, wa = Math.max(8, (W / 14) | 0), ha = Math.max(8, (H / 14) | 0), wb = Math.max(4, (W / 44) | 0), hb = Math.max(4, (H / 44) | 0);
    if (ta.width !== wa || ta.height !== ha) { ta.width = wa; ta.height = ha; tb.width = wb; tb.height = hb; }
    var xa = ta.getContext('2d'), xb = tb.getContext('2d'), xh = this.haze.getContext('2d');
    xb.clearRect(0, 0, wb, hb); xb.imageSmoothingEnabled = true; xb.drawImage(this.mask, 0, 0, wb, hb);
    xa.clearRect(0, 0, wa, ha); xa.imageSmoothingEnabled = true; xa.drawImage(tb, 0, 0, wa, ha);
    xh.globalCompositeOperation = 'source-over'; xh.clearRect(0, 0, W, H); xh.imageSmoothingEnabled = true; xh.drawImage(ta, 0, 0, W, H);
    xh.globalCompositeOperation = 'source-in'; xh.fillStyle = rgba(col, 1); xh.fillRect(0, 0, W, H);
  };
  R._tintFog = function (col) {
    var tmp = this._fogTmp || (this._fogTmp = canvas(512, 256)), t = tmp.getContext('2d');
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, 512, 256); t.drawImage(this.fogSprite, 0, 0, 512, 256); t.globalCompositeOperation = 'source-atop'; t.fillStyle = rgba(col, 1); t.fillRect(0, 0, 512, 256);
  };
  R._fog = function (ctx, e) {
    var wx = e.wx, f = wx.fog + wx.rain * 0.4; if (f < 0.02) return;
    var W = this.W, H = this.H, r = this.rect, col = mix3([66, 78, 100], [232, 237, 244], 0.15 + 0.85 * e.day);
    ctx.save();
    // 全体にごく薄いベール (濃さは一定 = 横線にならない)
    ctx.fillStyle = rgba(col, Math.min(0.5, f * 0.1)); ctx.fillRect(0, 0, W, H);
    // 空と地上の境(稜線)に沿ってもやを溜める: マスクを二段階にぼかして色を付ける
    if (!this._hazeOk || (this._hazeN = (this._hazeN || 0) + 1) % 24 === 0) { // 色を付けた素材は数フレームに1回だけ作り直す (毎フレームは重い)
      if (this.mask) this._buildHaze(col);
      this._tintFog(col); this._hazeOk = true;
    }
    if (this.mask) { ctx.globalAlpha = Math.min(0.6, f * 0.5); ctx.drawImage(this.haze, 0, 0); }
    // ゆっくり流れるもやの帯 (丸く淡く)
    var tmp = this._fogTmp, hy = r.y + r.h * this.o.horizon;
    for (var i = 0; i < this.fogBands.length; i++) {
      var b = this.fogBands[i], x = ((b.x + this.drift * 0.004 * b.sp) % 1.6) - 0.3, w = W * b.s * 0.8, h = w * 0.34;
      ctx.globalAlpha = Math.min(0.28, f * 0.22); ctx.drawImage(tmp, x * W - w / 2, hy + (b.y - 0.2) * r.h * 0.4 - h / 2, w, h);
    }
    ctx.restore();
  };

  // --- 雨: 角度のそろった先細りの筋を、継ぎ目のないタイルでスクロール (3層: 奥は細かく淡く、手前は長く)
  R._rainTiles = function () {
    if (this._rt) return this._rt;
    var cfg = [{ n: 120, len: [12, 22], w: 0.8, a: 0.5 }, { n: 48, len: [26, 42], w: 1.1, a: 0.6 }, { n: 15, len: [52, 76], w: 1.7, a: 0.7 }], P = 256, r = rng(5), tiles = [];
    cfg.forEach(function (c) {
      var cv = canvas(P, P), x = cv.getContext('2d');
      for (var i = 0; i < c.n; i++) {
        var px = r() * P, py = r() * P, len = lerp(c.len[0], c.len[1], r()), al = c.a * (0.6 + 0.4 * r());
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) { // 端をまたぐ筋は反対側にも描いて継ぎ目を消す
          var X = px + dx * P, Y = py + dy * P; if (X < -4 || X > P + 4 || Y < -len - 2 || Y > P + len + 2) continue;
          var g = x.createLinearGradient(X, Y - len, X, Y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,' + al.toFixed(3) + ')');
          x.fillStyle = g; x.fillRect(X - c.w / 2, Y - len, c.w, len);
        }
      }
      tiles.push(cv);
    });
    return (this._rt = tiles);
  };
  R._rain = function (ctx, e) {
    var a = e.wx.rain; if (a < 0.02) return;
    var W = this.W, H = this.H, u = Math.max(1, W / 1000), r = this.rect, o = this.o, tiles = this._rainTiles();
    var col = e.day > 0.3 ? [222, 233, 248] : [186, 203, 236], k = 0.55 + 0.45 * e.day;
    if (!this._rp || this._rpCtx !== ctx) { this._rp = tiles.map(function (t) { return ctx.createPattern(t, 'repeat'); }); this._rpCtx = ctx; }
    var ang = Math.atan(clamp(0.07 + e.wx.wind * 0.012, 0, 0.22)), D = Math.max(W, H) * 1.3;
    var sc = [1 * u, 1.2 * u, 1.5 * u], sp = [480 * u, 700 * u, 980 * u];
    var al = [(0.5 + 0.5 * a) * 0.5 * k, smooth(0.12, 0.5, a) * 0.6 * k, smooth(0.4, 0.85, a) * 0.65 * k];   // 弱い雨は奥の細かい筋だけ
    ctx.save();
    for (var li = 0; li < 3; li++) {
      if (al[li] < 0.02) continue;
      var off = (e.sec * sp[li]) % (256 * sc[li]);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(ang); ctx.scale(sc[li], sc[li]); ctx.translate(0, off / sc[li]);
      ctx.globalAlpha = al[li]; ctx.fillStyle = this._rp[li]; ctx.fillRect(-D / sc[li], -D / sc[li] - off / sc[li], 2 * D / sc[li], 2 * D / sc[li]);
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'round';
    // 水面・地面の波紋
    if (o.ripples) {
      this.rippleAcc += e.dt * a * 9;
      while (this.rippleAcc > 1) { this.rippleAcc -= 1; this.ripples.push({ x: Math.random(), y: r.y / H + (o.horizon + 0.1 + Math.random() * (0.97 - o.horizon - 0.1)) * r.h / H, t: 0, s: 0.6 + Math.random() * 0.8 }); }
      ctx.lineWidth = Math.max(0.8, u * 0.9);
      for (var j = this.ripples.length - 1; j >= 0; j--) {
        var rp = this.ripples[j]; rp.t += e.dt / 1.7;
        if (rp.t >= 1) { this.ripples.splice(j, 1); continue; }
        var depth = 0.45 + rp.y * 0.9, rad = (3 + rp.t * 24) * u * rp.s * depth, fade = Math.pow(1 - rp.t, 1.6);
        ctx.strokeStyle = rgba(col, 0.3 * fade);
        ctx.beginPath(); ctx.ellipse(rp.x * W, rp.y * H, rad, rad * 0.3, 0, 0, TAU); ctx.stroke();
        if (rp.t > 0.2) { ctx.strokeStyle = rgba(col, 0.18 * fade); ctx.beginPath(); ctx.ellipse(rp.x * W, rp.y * H, rad * 0.62, rad * 0.62 * 0.3, 0, 0, TAU); ctx.stroke(); }
      }
    }
    ctx.restore();
  };

  // --- 窓ガラスを伝う雫: ふわっと現れ、留まり、重みで加速して滑り、すーっと薄れて消える
  R._glass = function (ctx, e) {
    if (!this.o.glass) return;
    var a = e.wx.rain, kk = clamp((a - 0.1) / 0.5, 0, 1); if (kk < 0.02) return;
    var W = this.W, H = this.H, u = Math.max(1, W / 1000), n = Math.round(this.pool.glass.length * kk), gb = this.glassBox, gs = this.glassScale || 1;
    // 雫が映す景色は、半分の大きさの写しを数フレームに1度だけ撮って使い回す (描画中の画面そのものを毎回読み返すと重い)
    var snap = this._gsnap || (this._gsnap = canvas(2, 2)), hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    if (snap.width !== hw || snap.height !== hh) { snap.width = hw; snap.height = hh; this._gsn = 0; }
    if (!this._gsn) snap.getContext('2d').drawImage(ctx.canvas, 0, 0, hw, hh);
    this._gsn = ((this._gsn || 0) + 1) % 6; var src = snap, S2 = 0.5;
    if (gb) { ctx.save(); ctx.beginPath(); ctx.rect(gb.x, gb.y, gb.w, gb.h); ctx.clip(); }
    for (var i = 0; i < n; i++) {
      var d = this.pool.glass[i], rr0 = d.r * u * gs;
      if (d.T === undefined || d.age >= d.T) { // 次の雫を、ずらして仕込む
        d.T = 7 + Math.random() * 7; d.age = (d.T === undefined ? Math.random() * 8 : 0); if (gb) { d.x = (gb.x + Math.random() * gb.w) / W; d.y = (gb.y + Math.random() * gb.h * 0.75) / H; } else { d.x = Math.random(); d.y = Math.random() * 0.62; } d.y0 = d.y;
        d.v = 0; d.slideAt = 0.28 + Math.random() * 0.15; d.r = 3 + Math.random() * 6; d.wob = Math.random() * 6;
      }
      d.age += e.dt; var t = d.age / d.T, al, shrink = 1;
      if (t < 0.12) al = t / 0.12;                                     // ふわっと現れる
      else if (t < d.slideAt) al = 1;                                  // 留まる
      else {                                                           // 滑る: 加速しつつ、止まっては進む
        var tt = (t - d.slideAt) / (1 - d.slideAt), stick = 0.55 + 0.45 * Math.abs(Math.sin(e.sec * 2.3 + d.wob));
        d.v = Math.min(0.2, d.v + e.dt * 0.05); d.y += d.v * stick * e.dt; d.x += Math.sin(e.sec * 1.1 + d.wob) * e.dt * 0.0016;
        al = 1 - smooth(0.25, 1, tt); shrink = 1 - 0.35 * tt;           // 薄れながら少し小さくなる
      }
      if (al < 0.02) continue;
      var x = d.x * W, y = d.y * H, rr = rr0 * shrink;
      ctx.save(); ctx.globalAlpha = al; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 1.18, 0, 0, TAU); ctx.clip();
      ctx.translate(x, y); ctx.rotate(Math.PI);
      try { ctx.drawImage(src, (x - rr * 1.9) * S2, (y - rr * 2.2) * S2, rr * 3.8 * S2, rr * 4.4 * S2, -rr * 1.15, -rr * 1.35, rr * 2.3, rr * 2.7); } catch (err) { }
      ctx.restore();
      ctx.save(); ctx.globalAlpha = al;
      var gr = ctx.createRadialGradient(x - rr * 0.2, y - rr * 0.25, rr * 0.2, x, y, rr * 1.2);
      gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.75, 'rgba(15,25,45,0.0)'); gr.addColorStop(1, 'rgba(15,25,45,0.38)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 1.18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(x - rr * 0.32, y - rr * 0.42, rr * 0.22, rr * 0.13, -0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (gb) ctx.restore();
  };

  // --- 雪: 奥の細かな粒 / 中間 / 手前のぼんやりした大粒
  R._snow = function (ctx, e) {
    var a = e.wx.snow; if (a < 0.02) return;
    var W = this.W, H = this.H, u = Math.max(1, W / 1000), pool = this.pool.flakes;
    var layers = [{ n: 260, r: 0.9, v: 0.15, al: 0.6, off: 0 }, { n: 120, r: 2.2, v: 0.22, al: 0.75, off: 260 }, { n: 40, r: 6.5, v: 0.34, al: 0.45, off: 380 }];
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li], n = Math.round(L.n * (0.3 + 0.7 * a));
      ctx.globalAlpha = L.al;
      for (var i = 0; i < n; i++) {
        var p = pool[L.off + i]; p.y += e.dt * L.v * p.v * 0.5; p.x += Math.sin(e.sec * 0.7 * p.v + p.ph) * e.dt * 0.018 - e.dt * e.wx.wind * 0.0025;
        if (p.y > 1.03) { p.y = -0.03; p.x = Math.random(); } p.x = (p.x + 1) % 1;
        var s2 = L.r * u * 2 * (0.7 + 0.3 * p.v); ctx.drawImage(this.flake, p.x * W - s2 / 2, p.y * H - s2 / 2, s2, s2);
      }
    }
    ctx.globalAlpha = 1;
    var hz = ctx.createLinearGradient(0, H * 0.6, 0, H); hz.addColorStop(0, 'rgba(235,242,250,0)'); hz.addColorStop(1, rgba([235, 242, 250], a * 0.13));
    ctx.fillStyle = hz; ctx.fillRect(0, H * 0.6, W, H * 0.4);
  };

  // --- 季節の小さな動き
  R._ambient = function (ctx, e, seasons) {
    var wx = e.wx; if (wx.rain > 0.3 || wx.snow > 0.3) return;
    var W = this.W, H = this.H, u = Math.max(1, W / 1000), out = this.pool.amb;
    for (var si = 0; si < seasons.length; si++) {
      var A = AMBIENT[seasons[si].k]; if (!A || !A.n) continue;
      var inten = seasons[si].w * (A.when === 'night' ? e.night : e.day) * (1 - wx.cloud * 0.5), n = Math.round(A.n * inten); if (n < 1) continue;
      for (var i = 0; i < n; i++) {
        var p = out[i + (si ? 60 : 0)], x, y;
        if (A.kind === 'firefly') {
          p.x = (p.x + Math.cos(e.sec * 0.3 * p.v + p.ph) * e.dt * 0.01 + 1) % 1; p.y = clamp(p.y + Math.sin(e.sec * 0.4 * p.v + p.ph) * e.dt * 0.01, 0.6, 0.98);
          x = p.x * W; y = p.y * H;
          var b = Math.max(0, Math.sin(e.sec * 1.2 * p.v + p.ph)), rad = 7 * u * p.s, g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, 'rgba(220,255,150,' + (0.9 * b).toFixed(2) + ')'); g.addColorStop(1, 'rgba(220,255,150,0)');
          ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        } else { // 花びら・落ち葉: 風にゆれ、裏返りながらひらひら舞う
          var leaf = A.kind === 'leaf', depth = 0.5 + p.s * 0.55;                      // 奥行き (大きい = 手前)
          p.y += e.dt * (leaf ? 0.03 : 0.024) * (0.6 + 0.7 * p.v) * (0.6 + depth * 0.5);
          p.x += e.dt * (0.012 + wx.wind * 0.0045) * (0.5 + depth * 0.5) + Math.sin(e.sec * 0.8 * p.v + p.ph) * e.dt * (leaf ? 0.03 : 0.022);
          if (p.y > 1.04) { p.y = -0.04; p.x = Math.random(); } p.x = (p.x + 1) % 1;
          var flip = Math.cos(e.sec * (leaf ? 1.5 : 2.1) * p.v + p.ph), side = Math.abs(flip), sx = 0.18 + 0.82 * side;
          var rot = Math.sin(e.sec * 0.9 * p.v + p.ph) * (leaf ? 0.9 : 0.7) + e.sec * 0.22 * p.v + p.ph;
          var spr = leaf ? this.leaves[(p.c * this.leaves.length) | 0] : this.petals[(p.c * this.petals.length) | 0];
          var sz = (leaf ? 30 : 16) * u * depth;
          ctx.save(); ctx.translate(p.x * W, p.y * H); ctx.rotate(rot); ctx.scale(sx, 1);
          ctx.globalAlpha = (flip < 0 ? 0.74 : 0.95) * (0.65 + 0.35 * Math.min(1, depth));   // 裏返った時は少し暗く
          ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        }
      }
    }
  };

  // ------------------------------------------------------------------ 単体で使う: 任意の要素の上に空を重ねる
  function mount(target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('[UtsuroiSky] target not found: ' + target);
    if (el.__ls) el.__ls.destroy();
    var o = Object.assign({ weather: 'auto', date: null, fps: 30, maxDpr: 1.5, transitions: null, place: null, weatherAt: null, weatherProvider: null }, clean(opts));
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var cv = canvas(2, 2); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0';
    el.insertBefore(cv, el.firstChild);
    var ctx = cv.getContext('2d'), rd = new Renderer(o), maskC = canvas(2, 2), last = 0, running = true, raf, wt;
    rd.setSkyMask(maskC);
    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, o.maxDpr), W = Math.max(2, Math.round(el.clientWidth * dpr)), H = Math.max(2, Math.round(el.clientHeight * dpr));
      cv.width = maskC.width = W; cv.height = maskC.height = H; rd.resize(W, H);
      var m = maskC.getContext('2d'); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H * rd.o.horizon);
    }
    var ro = new ResizeObserver(resize); ro.observe(el); resize();
    var visible = true, io = global.IntersectionObserver ? new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }) : null; if (io) io.observe(el);
    var api = {
      renderer: rd,
      setWeather: function (w) {
        o.weather = w; clearTimeout(wt);
        if (w === 'auto') { var go = function () { var at = o.weatherAt || [rd.o.lat, rd.o.lon]; Promise.resolve((o.weatherProvider || fetchWeather)(at[0], at[1])).then(function (r) { if (o.weather === 'auto') rd.setWeather(r); }).catch(function () { }).then(function () { wt = setTimeout(go, 15 * 60e3); }); }; go(); }
        else rd.setWeather(w);
        return api;
      },
      setDate: function (d) { o.date = d ? new Date(d) : null; return api; },
      destroy: function () { running = false; cancelAnimationFrame(raf); clearTimeout(wt); ro.disconnect(); if (io) io.disconnect(); cv.remove(); delete el.__ls; }
    };
    api.setWeather(o.weather);
    if (o.place) geocode(o.place).then(function (p) { rd.o.lat = p.lat; rd.o.lon = p.lon; if (o.weather === 'auto') api.setWeather('auto'); }).catch(function (e) { console.warn('[UtsuroiSky]', e.message); });
    function tick(t) {
      if (!running) return; raf = requestAnimationFrame(tick);
      if (document.hidden || !visible || t - last < 1000 / o.fps) return;
      var dt = (t - last) / 1000; last = t; var date = o.date || new Date();
      ctx.clearRect(0, 0, cv.width, cv.height);
      rd.render(ctx, { date: date, t: t / 1000, dt: dt, seasons: seasonBlend(date, rd.o.lat, o.transitions) });
    }
    raf = requestAnimationFrame(tick);
    return (el.__ls = api);
  }

  global.UtsuroiSky = {
    Renderer: Renderer, mount: mount,
    astro: { celestial: celestial, subsolar: subsolar, sublunar: sublunar, moonEcl: moonEcl, sunTimes: sunTimes, moonTimes: moonTimes, moonInfo: moonInfo, moonPhase: moonPhase },
    weather: { presets: PRESETS, fromWmo: fromWmo, fetch: fetchWeather, resolve: resolveWeather, geocode: geocode },
    util: { seasonBlend: seasonBlend, timeBlend: timeBlend, refineSky: refineSky, TRANSITIONS: TRANSITIONS }
  };
})(window);

/*!
 * Utsuroi Globe — NASA の実データで、日本を中心にした地球を WebGL で描く (sky.js の後に読み込む)
 *
 *   昼夜: その時刻の「太陽が真上にある地点」から、昼側・夜側・夕暮れの境目を計算 (昼夜で絵がずれない: 同じ球体)
 *   季節: 1/4/7/10月の昼の地表を日付で混ぜる (雪・植生)
 *   夜側: 街明かり / 昼側: 雲・海の太陽の反射 / 縁: 大気の光 / 背景: 星
 *   読み込み: まず世界全体の粗い地図 (<id>-lo) で表示し、見えるタイル (<id>/<x>_<y>) だけ読んで高精細に差し替える
 *   視点: setView(緯度, 経度) でその地点が画面の中央やや下に来る
 */
(function (global) {
  'use strict';
  var Sky = global.UtsuroiSky;
  var RAD = Math.PI / 180;

  var VERT = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec3 uCam, uFwd, uRight, uUp, uSun; uniform vec2 uTan;',
    'uniform sampler2D uDayA, uDayB, uNight, uCo;',   // uCo: R = 雲, G = 海(1)/陸(0), B = 沿岸からの広いぼかし
    'uniform vec4 uBoxA, uBoxB, uBoxN, uBoxC;',        // 各地図の範囲 (経度の左端, 緯度の上端, 横幅の経度, 縦幅の緯度)。粗い地図は世界全体、高精細は見えるタイルの範囲
    'uniform float uMix, uCloudShift, uTime;',
    'uniform vec3 uMoonPos, uMoonDir, uMoonLight; uniform float uMoonR, uMoonIllum, uMoonAlpha;',
    'const float PI = 3.14159265;',
    'vec2 sphUV(vec3 n){ return vec2(atan(n.x, n.z) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI); }',
    'vec2 bx(vec4 b, float lon, float lat){ return vec2(mod(lon - b.x + 720.0, 360.0) / b.z, (b.y - lat) / b.w); }',
    // ---- 宇宙: 星 (丸い光の点・温度の色・明るい星は光条) と天の川。天球座標で描くので恒星時で回る
    'uniform float uGmst;',
    'float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
    'float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
    '             mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }',
    'float fbm(vec3 p){ float a = 0.5, t = 0.0; for (int i = 0; i < 5; i++) { t += a * vnoise(p); p *= 2.03; a *= 0.5; } return t; }',
    'vec3 starLayer(vec3 d, float scale, float dens, float size, float gain, float spikes){',
    '  vec3 id = floor(d * scale); float h = h31(id); if (h > dens) return vec3(0.0);',
    '  vec3 sd = normalize((id + 0.4 + 0.2 * vec3(h31(id + 1.7), h31(id + 3.1), h31(id + 5.3))) / scale);',
    '  vec3 o = d - sd; float r2 = dot(o, o), m = pow(h31(id + 9.1), 5.0);',              // 明るさ: 大半は暗い星
    '  float core = exp(-r2 / (size * size)), halo = exp(-r2 / (size * size * 6.0)) * 0.18 * m;',   // 小さな芯 + やわらかなにじみ (光条は付けない)
    '  vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), sd)), nn = cross(sd, e); float ox = abs(dot(o, e)), oy = abs(dot(o, nn));',
    '  float sp = (exp(-ox / (size * 0.3)) * exp(-oy / (size * 3.2)) + exp(-oy / (size * 0.3)) * exp(-ox / (size * 3.2))) * spikes * smoothstep(0.35, 0.9, m);',   // 光条
    '  vec3 tint = mix(vec3(0.66, 0.77, 1.0), vec3(1.0, 0.84, 0.64), h31(id + 7.7));',
    '  return tint * gain * (0.12 + 2.2 * m) * (core + halo);',
    '}',
    'vec3 stars(vec3 rdE){',
    '  float c = cos(uGmst), s = sin(uGmst); vec3 d = vec3(rdE.x * c + rdE.z * s, rdE.y, rdE.z * c - rdE.x * s);',   // 地球固定 → 天球
    '  const vec3 GP = vec3(-0.1980, 0.4560, -0.8677), GC = vec3(-0.8735, -0.4838, -0.0549);',   // 銀河の北極・銀河中心
    '  float gb = dot(d, GP), band = exp(-gb * gb / 0.035), core = exp(-dot(d - GC, d - GC) / 0.35);',
    '  float n = fbm(d * 5.0), n2 = fbm(d * 11.0 + 3.7);',
    '  vec3 col = vec3(0.50, 0.56, 0.72) * band * (0.35 + 0.65 * n) * (0.4 + 1.6 * core) * 0.15;',   // 天の川の帯
    '  col += vec3(0.95, 0.76, 0.52) * core * band * n * 0.16;',                                      // 銀河中心の暖かい輝き
    '  col *= 1.0 - smoothstep(0.45, 0.75, n2) * exp(-gb * gb / 0.004) * (0.5 + core) * 0.8;',       // 暗い塵の筋
    '  col += vec3(0.50, 0.16, 0.42) * smoothstep(0.58, 0.88, fbm(d * 3.0 + 9.1)) * band * 0.03;',   // ごく淡い星雲の色
    '  col += vec3(0.10, 0.32, 0.42) * smoothstep(0.62, 0.92, fbm(d * 2.5 + 21.0)) * 0.018;',
    '  col += starLayer(d, 260.0, 0.07, 0.0010, 0.4, 0.0) * (0.35 + 1.6 * band);',             // 細かく暗い星 (天の川沿いに多い)
    '  col += starLayer(d, 90.0, 0.045, 0.0013, 0.7, 0.0);',
    '  col += starLayer(d, 30.0, 0.05, 0.0017, 1.2, 1.0);',                                     // 明るい星 (光条つき)
    '  return col;',
    '}',
    // 月の模様 (表側は常に地球を向く): 月面の局所座標 (x,y) の海(暗い所)
    'float maria(vec2 p){',
    '  float a = 0.0;',
    '  a += 0.40 * exp(-dot(p - vec2(-0.30, 0.50), p - vec2(-0.30, 0.50)) / 0.09);',
    '  a += 0.34 * exp(-dot(p - vec2(0.12, 0.45), p - vec2(0.12, 0.45)) / 0.029);',
    '  a += 0.36 * exp(-dot(p - vec2(0.30, 0.18), p - vec2(0.30, 0.18)) / 0.04);',
    '  a += 0.32 * exp(-dot(p - vec2(0.68, 0.34), p - vec2(0.68, 0.34)) / 0.01);',
    '  a += 0.30 * exp(-dot(p - vec2(-0.62, 0.10), p - vec2(-0.62, 0.10)) / 0.115);',
    '  a += 0.30 * exp(-dot(p - vec2(-0.22, -0.38), p - vec2(-0.22, -0.38)) / 0.036);',
    '  a += 0.26 * exp(-dot(p - vec2(0.52, -0.12), p - vec2(0.52, -0.12)) / 0.02);',
    '  return clamp(0.97 - a + 0.035 * sin(p.x * 9.0 + p.y * 7.0) * sin(p.x * 13.0 - p.y * 5.0), 0.42, 1.0);',
    '}',
    'void main(){',
    '  vec2 q = (vUv * 2.0 - 1.0) * uTan;',
    '  vec3 rd = normalize(uFwd + uRight * q.x + uUp * q.y);',
    '  float b = dot(uCam, rd), c = dot(uCam, uCam) - 1.0, h = b * b - c;',
    '  float tE = (h > 0.0 && b < 0.0) ? -b - sqrt(h) : 1e9;',
    // 月 (演出上の距離・大きさ。向きは実際の計算どおり)
    '  vec3 om = uCam - uMoonPos; float bm = dot(om, rd), hm = bm * bm - (dot(om, om) - uMoonR * uMoonR);',
    '  float tM = (hm > 0.0 && bm < 0.0) ? -bm - sqrt(hm) : 1e9;',
    '  vec3 col = vec3(0.0);',
    '  vec3 moonDir = uMoonDir;',   // 実際の月の方向 (月明かり・海の反射に使う)
    '  if (tE < tM) {',
    '    vec3 pos = uCam + rd * tE; vec3 n = normalize(pos); vec3 V = -rd;',
    '    float lon = atan(n.x, n.z) * 57.29578, lat = asin(clamp(n.y, -1.0, 1.0)) * 57.29578;',
    '    vec3 dayc = mix(texture2D(uDayA, bx(uBoxA, lon, lat)).rgb, texture2D(uDayB, bx(uBoxB, lon, lat)).rgb, uMix);',
    '    dayc = mix(dayc, vec3(dot(dayc, vec3(0.3, 0.59, 0.11))), 0.22) * 0.94;',
    '    vec3 nightc = texture2D(uNight, bx(uBoxN, lon, lat)).rgb;',
    '    vec3 co = texture2D(uCo, bx(uBoxC, lon, lat)).rgb, coS = texture2D(uCo, bx(uBoxC, lon - uCloudShift, lat)).rgb;',
    '    float cl = smoothstep(0.2, 0.9, coS.r), water = co.g, shallow = clamp((1.0 - co.b) * 1.6, 0.0, 1.0);',
    '    float ndl = dot(n, uSun), day = smoothstep(-0.06, 0.18, ndl), lit = max(ndl, 0.0), mu = max(dot(n, V), 0.0);',
    '    float tw = smoothstep(-0.16, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.22, ndl));',
    // 人の目で見た地表: 陸はくすみ、海は海底地形の見えない深い紺 (沿岸だけ少し明るい)
    '    vec3 land = mix(dayc, vec3(dot(dayc, vec3(0.3, 0.59, 0.11))), 0.2) * 1.05;',
    '    vec3 sea = mix(vec3(0.010, 0.035, 0.085), vec3(0.03, 0.11, 0.17), shallow);',
    '    vec3 dc = mix(land, sea, water) * (0.06 + 1.05 * lit);',
    '    vec3 Hh = normalize(uSun + V); float nh = max(dot(n, Hh), 0.0);',                     // 海に映る太陽 (広い反射 + 芯)
    '    dc += vec3(0.62, 0.68, 0.74) * (pow(nh, 22.0) * 0.16 + pow(nh, 90.0) * 0.12) * water * (1.0 - cl) * lit;',   // サングリント: 波で散って広く、灰色がかった銀色 (鋭い白い芯にはならない)
    '    dc = mix(dc, vec3(1.0) * (0.05 + 1.0 * lit), cl * 0.92);',                           // 雲がいちばん白く目立つ
    // 大気のもや: 斜めに見るほど厚い (大陸の輪郭がぼやける)
    '    float haze = 1.0 - exp(-0.075 / max(mu, 0.06));',
    '    vec3 hazeCol = vec3(0.30, 0.50, 0.95) * (0.04 + 0.9 * smoothstep(-0.15, 0.45, ndl));',
    '    dc = mix(dc, hazeCol, clamp(haze, 0.0, 0.85)) + vec3(0.015, 0.03, 0.07) * lit;',
    '    dc = mix(dc, dc * vec3(1.4, 0.75, 0.5), tw * 0.6);',
    // 夜側: 街明かりは控えめに (もや・雲で和らぐ) + 月明かり
    '    float ml = max(dot(n, moonDir), 0.0) * uMoonIllum;',
    '    vec3 nc = mix(land, sea, water) * 0.12 * ml * vec3(0.75, 0.85, 1.1) + vec3(0.0, 0.006, 0.016);',
    '    nc += pow(nightc, vec3(1.3)) * vec3(1.5, 1.1, 0.65) * (1.0 - cl * 0.6) * (1.0 - haze * 0.6);',
    '    nc = mix(nc, nc + vec3(0.03, 0.035, 0.06) * (0.3 + ml), cl);',
    '    vec3 Rm = reflect(-moonDir, n); nc += vec3(0.75, 0.82, 1.0) * pow(max(dot(Rm, V), 0.0), 60.0) * water * (1.0 - cl) * ml * 0.5;',
    '    col = mix(nc, dc, day);',
    '    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);',
    '    col += vec3(0.28, 0.55, 1.0) * fres * (0.08 + 0.95 * smoothstep(-0.35, 0.45, ndl));',
    '    col += vec3(1.0, 0.45, 0.15) * fres * tw * 0.55;',
    '  } else if (tM < 1e8) {',
    '    vec3 pm = uCam + rd * tM, nm = normalize(pm - uMoonPos);',
    '    vec3 ax = normalize(uCam - uMoonPos), rx = normalize(cross(vec3(0.0, 1.0, 0.0), ax)), ry = cross(ax, rx);',   // 表側をこちらに向ける
    '    float alb = maria(vec2(dot(nm, rx), dot(nm, ry)));',
    '    float l = max(dot(nm, uMoonLight), 0.0);',   // 実際の満ち欠けになる光の向き
    '    col = (vec3(1.0, 0.97, 0.9) * alb * (smoothstep(-0.02, 0.25, dot(nm, uMoonLight)) * (0.25 + 0.85 * l)) + vec3(0.02, 0.025, 0.035) * alb) * uMoonAlpha + stars(rd) * (1.0 - uMoonAlpha);',
    '  } else {',
    '    vec3 pc = uCam + rd * (-b); float alt = length(pc) - 1.0;',
    '    float ld = smoothstep(-0.4, 0.45, dot(normalize(pc), uSun)), tw2 = smoothstep(-0.3, 0.0, dot(normalize(pc), uSun)) * (1.0 - smoothstep(0.0, 0.3, dot(normalize(pc), uSun)));',
    '    float halo = (b < 0.0) ? exp(-max(alt, 0.0) * 55.0) : 0.0;',
    '    col = stars(rd) * (1.0 - clamp(halo * 2.5, 0.0, 1.0));',
    '    col += vec3(0.22, 0.5, 1.0) * halo * (0.12 + 0.9 * ld) * 0.9 + vec3(1.0, 0.45, 0.15) * halo * tw2 * 0.5;',
    // 太陽: 視界に入る時だけ (地球・月に隠れていなければ)
    '    float sd = max(dot(rd, uSun), 0.0);',
    '    col += vec3(1.0, 0.96, 0.88) * (pow(sd, 3000.0) * 3.0 + pow(sd, 400.0) * 0.6 + pow(sd, 40.0) * 0.12);',
    '  }',
    '  col = pow(col, vec3(0.92));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var ANCHORS = [{ d: 15, k: 'jan' }, { d: 105, k: 'apr' }, { d: 196, k: 'jul' }, { d: 288, k: 'oct' }];
  function seasonPair(date) { // 日付で隣り合う2つの月別地表と混ぜ比
    var y = new Date(date.getFullYear(), 0, 0), d = Math.floor((date - y) / 864e5), i, a, b, t;
    var list = ANCHORS.concat([{ d: ANCHORS[0].d + 365, k: ANCHORS[0].k }]); if (d < ANCHORS[0].d) d += 365;
    for (i = 0; i < 4; i++) if (d >= list[i].d && d < list[i + 1].d) { a = list[i]; b = list[i + 1]; t = (d - a.d) / (b.d - a.d); return { a: a.k, b: b.k, t: t * t * (3 - 2 * t) }; }
    return { a: 'jan', b: 'jan', t: 0 };
  }

  var WORLD = [-180, 90, 360, 180], TILE_DEG = 45, TILE_PX = 512, COLS = 8, ROWS = 4;
  var MAPS = ['night', 'co'];   // 季節の地図 (day-*) は日付で必要な2枚だけ
  function pow2(n) { var p = 1; while (p < n) p *= 2; return p; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function Globe(opts) {
    this.o = Object.assign({ viewLat: 34.69, viewLon: 135.19, viewY: -0.1, camLat: 20, camLon: 137, dist: 2.1, pitch: 16, fov: 46, sway: true }, opts || {});
    this.maps = {}; this.base = ''; this.ready = false; this.plan = null; this.aspect = 1.5;
    this.setView(this.o.viewLat, this.o.viewLon);
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = 2;
    var gl = this.gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }) || this.canvas.getContext('experimental-webgl');
    this.ok = !!gl;
    if (!gl) return;
    var vs = this._shader(gl.VERTEX_SHADER, VERT), fs = this._shader(gl.FRAGMENT_SHADER, FRAG), pr = this.prog = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('[UtsuroiGlobe]', gl.getProgramInfoLog(pr)); this.ok = false; return; }
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; var self = this;
    ['uCam', 'uFwd', 'uRight', 'uUp', 'uSun', 'uTan', 'uDayA', 'uDayB', 'uNight', 'uCo', 'uBoxA', 'uBoxB', 'uBoxN', 'uBoxC', 'uMix', 'uCloudShift', 'uTime', 'uMoonPos', 'uMoonDir', 'uMoonLight', 'uMoonR', 'uMoonIllum', 'uMoonAlpha', 'uGmst'].forEach(function (n) { self.u[n] = gl.getUniformLocation(pr, n); });
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  }
  var G = Globe.prototype;
  G._shader = function (type, src) { var gl = this.gl, s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('[UtsuroiGlobe]', gl.getShaderInfoLog(s)); return s; };

  // ---- カメラ
  G._camera = function (camLat, camLon, pitch) { // 地球半径 = 1。画面の右 = 東、上 = 北寄り
    var o = this.o, lat = camLat * RAD, lon = camLon * RAD, pit = pitch * RAD;
    var C = [o.dist * Math.cos(lat) * Math.sin(lon), o.dist * Math.sin(lat), o.dist * Math.cos(lat) * Math.cos(lon)], Cn = norm(C);
    var east = norm(cross([0, 1, 0], Cn)), north = norm(cross(Cn, east));
    var fwd = norm([-Cn[0] * Math.cos(pit) + north[0] * Math.sin(pit), -Cn[1] * Math.cos(pit) + north[1] * Math.sin(pit), -Cn[2] * Math.cos(pit) + north[2] * Math.sin(pit)]);
    return { C: C, fwd: fwd, right: east, up: cross(east, fwd) };
  };
  /** 見たい地点 (緯度・経度) を指定。その地点が画面の中央やや下 (viewY) に来るよう、カメラの位置を計算する */
  G.setView = function (lat, lon) {
    var o = this.o; o.viewLat = Math.max(-80, Math.min(80, +lat)); o.viewLon = ((+lon + 540) % 360) - 180; o.camLon = o.viewLon;
    var lo = o.viewLat - 60, hi = o.viewLat + 20;
    for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2, y = this._projectY(mid); if (y === null) hi = mid; else if (y > o.viewY) lo = mid; else hi = mid; }   // 二分探索 (カメラを北へ寄せるほど、地点は画面の下へ動く)
    o.camLat = Math.max(-85, Math.min(85, (lo + hi) / 2));
    if (this.gl) this._replan();
    return this;
  };
  G._projectY = function (camLat) { // カメラを camLat に置いた時、見たい地点が画面のどの高さに来るか (-1..1)
    var o = this.o, cam = this._camera(camLat, o.camLon, o.pitch), tl = o.viewLat * RAD, tn = o.viewLon * RAD;
    var P = [Math.cos(tl) * Math.sin(tn), Math.sin(tl), Math.cos(tl) * Math.cos(tn)], v = norm([P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]]), z = dot(v, cam.fwd);
    return z <= 0 ? null : dot(v, cam.up) / z / Math.tan(o.fov * RAD / 2);
  };

  // ---- 見えるタイル: 画面の中を光線で調べ (カメラの漂いの幅も含めて)、地表に当たる所のタイルを集める
  G._visibleTiles = function () {
    var o = this.o, th = Math.tan(o.fov * RAD / 2), cols = {}, rows = {}, asp = this.aspect;
    var sw = o.sway ? 1 : 0, offs = [[0, 0, 0], [0.3 * sw, 0.5 * sw, 0.3 * sw], [-0.3 * sw, -0.5 * sw, -0.3 * sw]];
    for (var k = 0; k < offs.length; k++) {
      var cam = this._camera(o.camLat + offs[k][0], o.camLon + offs[k][1], o.pitch + offs[k][2]), C = cam.C;
      for (var i = 0; i <= 40; i++) for (var j = 0; j <= 30; j++) {
        var qx = (i / 40 * 2 - 1) * th * asp, qy = (j / 30 * 2 - 1) * th;
        var rd = norm([cam.fwd[0] + cam.right[0] * qx + cam.up[0] * qy, cam.fwd[1] + cam.right[1] * qx + cam.up[1] * qy, cam.fwd[2] + cam.right[2] * qx + cam.up[2] * qy]);
        var b = dot(C, rd), h = b * b - (dot(C, C) - 1); if (h <= 0 || b >= 0) continue;
        var t = -b - Math.sqrt(h), p = [C[0] + rd[0] * t, C[1] + rd[1] * t, C[2] + rd[2] * t];
        var la = Math.asin(Math.max(-1, Math.min(1, p[1]))) / RAD, lo = Math.atan2(p[0], p[2]) / RAD;
        for (var dl = -4; dl <= 4; dl += 8) for (var dn = -4; dn <= 4; dn += 8) {   // 少し余白
          cols[(((Math.floor((lo + dn + 180) / TILE_DEG)) % COLS) + COLS) % COLS] = 1;
          rows[Math.max(0, Math.min(ROWS - 1, Math.floor((90 - (la + dl)) / TILE_DEG)))] = 1;
        }
      }
    }
    var cs = Object.keys(cols).map(Number), rs = Object.keys(rows).map(Number);
    if (!cs.length) return null;
    var tx0 = 0, ntx = COLS;
    if (cs.length < COLS) { // 経度は円環: 一番大きな「要らない列」の切れ目のすぐ後ろから始める
      var best = -1;
      for (var c = 0; c < COLS; c++) if (!cols[c] && cols[(c + COLS - 1) % COLS]) { var gap = 0; while (!cols[(c + gap) % COLS] && gap < COLS) gap++; if (gap > best) { best = gap; tx0 = (c + gap) % COLS; ntx = COLS - gap; } }
    }
    var ty0 = Math.min.apply(null, rs), nty = Math.max.apply(null, rs) - ty0 + 1;
    return { tx0: tx0, ntx: ntx, ty0: ty0, nty: nty, key: tx0 + ',' + ntx + ',' + ty0 + ',' + nty };
  };
  G._replan = function () { this.plan = this._visibleTiles(); var self = this; Object.keys(this.maps).forEach(function (id) { self._hi(self.maps[id]); }); };

  // ---- 読み込み: 粗い地図 → 見えるタイルの高精細
  /** base 下の地図を読み込む (拡張子は ext)。まず粗い地図で表示し、見えるタイルを順に読む */
  G.load = function (base, ext) {
    if (!this.ok) return;
    this.base = base.replace(/\/?$/, '/'); this.ext = ext || 'webp';
    var sp = seasonPair(new Date()), self = this;
    if (!this.plan) this.plan = this._visibleTiles();
    MAPS.concat(['day-' + sp.a, 'day-' + sp.b]).forEach(function (id) { self._map(id); });
  };
  G._texture = function (src, w, h) { // src: 画像 or null (後からタイルを書き込む)
    var gl = this.gl, tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tx;
  };
  G._mip = function (tx) { var gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tx); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); };
  G._img = function (url, ok) { var im = new Image(); im.crossOrigin = 'anonymous'; im.onload = function () { ok(im); }; im.onerror = function () { }; im.src = url; };
  G._map = function (id) {
    var m = this.maps[id]; if (m) return m;
    var self = this; m = this.maps[id] = { id: id, lo: null, hi: null, hiBox: null, hiKey: '', loading: '' };
    this._img(this.base + id + '-lo.' + this.ext, function (im) { m.lo = self._texture(im); self._mip(m.lo); self._checkReady(); self._hi(m); });
    return m;
  };
  G._hi = function (m) {
    var p = this.plan; if (!p || !m.lo || m.hiKey === p.key || m.loading === p.key) return;
    var self = this, gl = this.gl, key = p.key, W = pow2(p.ntx * TILE_PX), H = pow2(p.nty * TILE_PX), tx = this._texture(null, W, H), left = p.ntx * p.nty;
    m.loading = key;
    for (var i = 0; i < p.ntx; i++) for (var j = 0; j < p.nty; j++) (function (i, j) {
      self._img(self.base + m.id + '/' + ((p.tx0 + i) % COLS) + '_' + (p.ty0 + j) + '.' + self.ext, function (im) {
        if (m.loading !== key) return;
        gl.bindTexture(gl.TEXTURE_2D, tx); gl.texSubImage2D(gl.TEXTURE_2D, 0, i * TILE_PX, j * TILE_PX, gl.RGB, gl.UNSIGNED_BYTE, im);
        if (--left === 0) { // そろったら高精細に切り替え
          self._mip(tx); if (m.hi) gl.deleteTexture(m.hi);
          m.hi = tx; m.hiKey = key; m.loading = ''; m.hiBox = [-180 + p.tx0 * TILE_DEG, 90 - p.ty0 * TILE_DEG, W / TILE_PX * TILE_DEG, H / TILE_PX * TILE_DEG];
        }
      });
    })(i, j);
  };
  G._checkReady = function () {
    var m = this.maps, day = ['day-jan', 'day-apr', 'day-jul', 'day-oct'].some(function (k) { return m[k] && m[k].lo; });
    this.ready = !!(m.night && m.night.lo && m.co && m.co.lo && day);
  };
  G._active = function (m) { // 使う地図: 高精細がそろっていればそれ、無ければ粗い地図
    if (m && m.hi && this.plan && m.hiKey === this.plan.key) return { t: m.hi, box: m.hiBox };
    if (m && m.lo) return { t: m.lo, box: WORLD };
    return null;
  };
  G.resize = function (W, H) {
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
      var a = W / H; if (Math.abs(a - this.aspect) > 0.05) { this.aspect = a; if (this.ok && this.base) this._replan(); }
    }
    if (this.gl) this.gl.viewport(0, 0, W, H);
  };
  G.dispose = function () {
    var gl = this.gl, self = this; if (!gl) return;
    Object.keys(this.maps).forEach(function (k) { var m = self.maps[k]; if (m.lo) gl.deleteTexture(m.lo); if (m.hi) gl.deleteTexture(m.hi); m.loading = 'x'; });
    this.maps = {}; this.ready = false;
  };

  G.render = function (date, sec) {
    var gl = this.gl, o = this.o, u = this.u; if (!this.ok || !this.ready) return false;
    var sw = o.sway ? 1 : 0, cam = this._camera(o.camLat + Math.sin(sec * 0.006) * 0.25 * sw, o.camLon + Math.sin(sec * 0.004 + 1) * 0.4 * sw, o.pitch + Math.sin(sec * 0.005 + 2) * 0.25 * sw);   // ごくわずかに漂うカメラ (十数分周期)
    var C = cam.C, fwd = cam.fwd, right = cam.right, up = cam.up, ss = Sky.astro.subsolar(date), sl = ss.lat * RAD, so = ss.lon * RAD;
    var sun = [Math.cos(sl) * Math.sin(so), Math.sin(sl), Math.cos(sl) * Math.cos(so)];
    var th = Math.tan(o.fov * RAD / 2), asp = this.canvas.width / this.canvas.height, sp = seasonPair(date);
    var A = this._active(this._map('day-' + sp.a)), B = this._active(this._map('day-' + sp.b));   // 日付で必要になった季節を読む
    if (!A) A = this._active(this.maps['day-jan']) || this._active(this.maps['day-apr']) || this._active(this.maps['day-jul']) || this._active(this.maps['day-oct']);
    if (!B) B = A;
    var N = this._active(this.maps.night), CO = this._active(this.maps.co);
    if (!A || !N || !CO) return false;
    gl.useProgram(this.prog);
    gl.uniform3fv(u.uCam, C); gl.uniform3fv(u.uFwd, fwd); gl.uniform3fv(u.uRight, right); gl.uniform3fv(u.uUp, up); gl.uniform3fv(u.uSun, sun);
    // 月: 実際の方向・距離・大きさ (地球半径 = 1)。満ち欠けは太陽の光で自然に決まる
    var ml = Sky.astro.sublunar(date), mla = ml.lat * RAD, mlo = ml.lon * RAD, mi = Sky.astro.moonInfo(date), md = ml.distKm / 6371;
    var mdir = [Math.cos(mla) * Math.sin(mlo), Math.sin(mla), Math.cos(mla) * Math.cos(mlo)];
    gl.uniform3f(u.uMoonPos, mdir[0] * md, mdir[1] * md, mdir[2] * md); gl.uniform3fv(u.uMoonDir, mdir); gl.uniform3fv(u.uMoonLight, sun);
    gl.uniform1f(u.uMoonR, 1737.4 / 6371); gl.uniform1f(u.uMoonIllum, mi.illumination); gl.uniform1f(u.uMoonAlpha, 1);
    var jdn = date.getTime() / 864e5 + 2440587.5 - 2451545.0;
    gl.uniform1f(u.uGmst, ((((18.697374558 + 24.06570982441908 * jdn) % 24) + 24) % 24) * 15 * RAD);   // 恒星時: 星空は1日で1回転
    gl.uniform2f(u.uTan, th * asp, th); gl.uniform1f(u.uMix, A === B ? 0 : sp.t); gl.uniform1f(u.uTime, sec);
    gl.uniform1f(u.uCloudShift, (sec * 0.00054) % 360);   // 雲はほぼ止まって見える速さ (度)
    var binds = [[A, u.uDayA, u.uBoxA], [B, u.uDayB, u.uBoxB], [N, u.uNight, u.uBoxN], [CO, u.uCo, u.uBoxC]];
    for (var i = 0; i < binds.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, binds[i][0].t); gl.uniform1i(binds[i][1], i); gl.uniform4fv(binds[i][2], binds[i][0].box); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  };
  /** 読み込み状況 (デバッグ用) */
  G.status = function () { var self = this; return { plan: this.plan && this.plan.key, maps: Object.keys(this.maps).map(function (k) { var m = self.maps[k]; return k + ':' + (m.hi && m.hiKey === (self.plan && self.plan.key) ? 'hi' : m.lo ? 'lo' : '-'); }) }; };

  global.UtsuroiGlobe = { Renderer: Globe, seasonPair: seasonPair };
})(window);

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
    cyber:    { name: 'サイバー',   horizon: 0.55, top: 0.08, ground: [50, 40, 90],  city: true },
    beach:    { name: 'ビーチ',     horizon: 0.50, top: 0.08, ground: [225, 205, 160] },
    home:     { name: '家',         horizon: 0.55, top: 0.12, ground: [150, 120, 95], layered: true, glass: { box: [0.25, 0.03, 0.99, 0.64], scale: 0.5 } },   // glass: 窓ガラスの範囲 (遠い窓なので水滴は範囲内に小さく)   // 窓の外(季節×時間) + 屋内(時間 + 小物の有無)
    office:   { name: 'オフィス',   horizon: 0.55, top: 0.12, ground: [110, 115, 125], city: true, layered: true, outsideShift: 0.1, glass: { box: [0.17, 0.09, 0.97, 0.55], scale: 0.5 } },   // 窓の外の絵を上へずらし、窓の下端に街並みを見せる
    earth:    { name: '地球',       horizon: 0.60, top: 0.10, ground: [40, 90, 140], celestial: false, noSky: true, globe: true },   // NASA の実データで球体を描く (globe.js)   // 空から見た景色: 空の合成・天気は使わない
    temple:   { name: '寺',         horizon: 0.55, top: 0.08, ground: [95, 100, 85] },
    fantasy:  { name: 'ファンタジー', horizon: 0.55, top: 0.08, ground: [40, 90, 70] }
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
      fps: 30, ambient: true, base: DEFAULT_BASE, format: 'webp', maxDpr: 1.5, transitions: null,
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
    this.sky.setWater(null);
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

  P._frame = function (t) {
    if (document.hidden || !this.visible) return;                // 見えていない時は描かない
    if (t - this.last < 1000 / this.o.fps) return;
    var t0 = performance.now();
    var dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    var date = this.o.date || new Date(), o = this.o;
    this.sky.o.lat = o.lat; this.sky.o.lon = o.lon; this.sky.o.ambient = o.ambient;

    var cel = Sky.astro.celestial(date, o.lat, o.lon);
    var sb = Sky.util.seasonBlend(date, o.lat, o.transitions), tb = Sky.util.timeBlend(cel.sun.alt, cel.sun.morning);
    var ps = this.T.layered ? propsetFor(date, o.lat) : '';
    var key = ps + sb.map(function (s) { return s.k + s.w.toFixed(2); }).join() + tb.map(function (s) { return s.k + s.w.toFixed(2); }).join() + this.matteCount;
    if (!this.T.globe && (this.dirty || key !== this.sceneKey)) { if (this._compose(sb, tb, ps)) { this.sceneKey = key; this.dirty = false; } }

    var ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.T.globe) {
      if (this.globe && this.globe.ok) { this.globe.resize(this.W, this.H); if (this.globe.render(date, t / 1000)) { ctx.drawImage(this.globe.canvas, 0, 0); this.sceneKey = 'globe'; } }
    } else ctx.drawImage(this.scene, 0, 0);
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

  // <div data-utsuroi="city" data-lat data-lon data-weather="auto|clear|cloudy|drizzle|rain|shower|sunshower|snow|fog|thunder|off" data-time="ISO" data-base data-format data-fps data-ambient="off" data-view="緯度,経度" data-place="地名|auto" data-weather-at="緯度,経度">
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
        fps: d.fps ? parseInt(d.fps, 10) : undefined, ambient: d.ambient !== 'off',
        view: d.view ? d.view.split(',').map(Number) : undefined   // 地球: data-view="緯度,経度"
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();

  global.Utsuroi = Utsuroi;
})(window);
