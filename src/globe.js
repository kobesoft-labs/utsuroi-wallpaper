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
