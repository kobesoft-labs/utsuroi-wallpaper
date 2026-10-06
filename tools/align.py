#!/usr/bin/env python3
"""全画像を基準画像(summer-day)の位置に合わせる。

AI の「編集」は絵を描き直すので、季節・時間帯ごとに山や建物の位置が数pxずれる。
そのまま混ぜると境の日に二重にぼやけるため、オプティカルフローで推定して重ね直す。

  .venv/bin/python tools/align.py [--theme kobe]

入力:  images-src/<theme>/*.png  (原本)
出力:  images-aligned/<theme>/*.png  (位置合わせ済み。tools/optimize.mjs が優先して使う)
cloud-<time> は、元になった summer-<time> と同じワープをかける。mask / water は基準画像から作ったのでそのまま。
"""
import argparse
import os
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
import json
THEMES = json.load(open(os.path.join(ROOT, "themes.json")))["themes"]
SRC = os.path.join(ROOT, "images-src")
OUT = os.path.join(ROOT, "images-aligned")
REF_NAME = "summer-day.png"
REF_INSIDE = "in-mild-day.png"   # 屋内レイヤー(in-*)の基準
SCALE = 0.5          # フロー推定は縮小して行う
SMOOTH = 12.0        # フローのなめらかさ(縮小後px)。局所の変化(葉・雪)や手がかりの少ない空・海に引きずられないように
MAX_SHIFT = 14.0     # 縮小後pxでの最大移動量 (実際に必要なずれは 10〜25px 程度)


def structure(img):
    """昼夜・季節で見た目が変わっても残る「形」だけを取り出す(局所コントラスト正規化)"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.4)
    mu = cv2.GaussianBlur(g, (0, 0), 10)
    d = g - mu
    sd = np.sqrt(cv2.GaussianBlur(d * d, (0, 0), 10)) + 5.0
    return np.clip(d / sd * 42 + 128, 0, 255).astype(np.uint8)


def make_dis():
    if hasattr(cv2, "DISOpticalFlow_create"):
        return cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    return cv2.DISOpticalFlow.create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)


def estimate(ref, img):
    a = structure(cv2.resize(ref, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA))
    b = structure(cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA))
    try:
        flow = make_dis().calc(a, b, None)
    except Exception:
        flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 5, 31, 5, 7, 1.5, 0)
    flow = cv2.GaussianBlur(flow, (0, 0), SMOOTH)
    mag = np.sqrt((flow ** 2).sum(-1, keepdims=True))
    flow = np.where(mag > MAX_SHIFT, flow * (MAX_SHIFT / np.maximum(mag, 1e-6)), flow)
    return flow, a, b


def warp(img, flow):
    h, w = img.shape[:2]
    f = cv2.resize(flow, (w, h), interpolation=cv2.INTER_CUBIC) / SCALE
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img, xs + f[..., 0], ys + f[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def error(a, b):
    return float(np.mean(np.abs(a.astype(np.float32) - b.astype(np.float32))))


def align_pair(ref_path, img_path, out_path, shift=None, smooth=None):
    """img を ref の位置に合わせて out に書く (地球の地図: AI で描き直した絵を元の地図の海岸線に合わせる)"""
    global MAX_SHIFT, SMOOTH
    if shift is not None: MAX_SHIFT = shift
    if smooth is not None: SMOOTH = smooth
    ref = cv2.imread(ref_path, cv2.IMREAD_COLOR); img = cv2.imread(img_path, cv2.IMREAD_COLOR)
    img = cv2.resize(img, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_CUBIC)
    flow, a, b = estimate(ref, img)
    out = warp(img, flow)
    a2 = structure(cv2.resize(out, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA))
    cv2.imwrite(out_path, out)
    print(f"{os.path.basename(img_path)}: 構造のずれ {error(a, b):5.1f} → {error(a, a2):5.1f}  最大移動 {np.abs(flow).max() / SCALE:5.1f}px")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", help="カンマ区切り。省略で全テーマ")
    ap.add_argument("--pair", nargs=3, metavar=("REF", "IMG", "OUT"), help="2枚だけ合わせる")
    ap.add_argument("--max-shift", type=float, default=None)
    ap.add_argument("--smooth", type=float, default=None)
    args = ap.parse_args()
    if args.pair:
        align_pair(*args.pair, shift=args.max_shift, smooth=args.smooth)
        return
    themes = args.theme.split(",") if args.theme else sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
    for theme in themes:
        d = os.path.join(SRC, theme)
        if THEMES.get(theme, {}).get("noAlign"):   # 写真が元で、ビルの形を守りたいテーマ: 位置合わせのワープは建物を曲げるので、そのまま使う
            out = os.path.join(OUT, theme); os.makedirs(out, exist_ok=True)
            for n in sorted(os.listdir(d)):
                if n.endswith(".png"):
                    cv2.imwrite(os.path.join(out, n), cv2.imread(os.path.join(d, n), cv2.IMREAD_UNCHANGED))
            print(f"[{theme}] 位置合わせなし (noAlign)")
            continue
        ref_path = os.path.join(d, REF_NAME)
        if not os.path.exists(ref_path):
            print(f"[{theme}] {REF_NAME} が無いのでスキップ")
            continue
        ref = cv2.imread(ref_path, cv2.IMREAD_COLOR)
        out = os.path.join(OUT, theme)
        os.makedirs(out, exist_ok=True)
        flows = {}
        ref_in_path = os.path.join(d, REF_INSIDE)
        names = [n for n in sorted(os.listdir(d)) if n.endswith(".png") and not n.startswith(("mask", "water", "cloud-"))]
        # 1) 位置合わせの推定は「<季節>-day」だけで行う (昼は構造の手がかりが多く確かに合う)
        for name in names:
            if name.startswith("in-") or not name.endswith("-day.png") or name == REF_NAME:
                continue
            img = cv2.imread(os.path.join(d, name), cv2.IMREAD_COLOR)
            flow, a, b = estimate(ref, img)
            flows[name] = flow
            a2 = structure(cv2.resize(warp(img, flow), None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA))
            print(f"[{theme}] {name:18s} 構造のずれ {error(a, b):5.1f} → {error(a, a2):5.1f}  最大移動 {np.abs(flow).max() / SCALE:5.1f}px")
        # 2) 夜明け・夕方・夜は、同じ季節の昼と同じワープをそのまま使う。
        #    (昼の絵の編集で作られているので、昼と同じ動きで位置が合う。暗い絵で単独に推定するとビルが歪むため)
        for name in names:
            out_path = os.path.join(out, name)
            img = cv2.imread(os.path.join(d, name), cv2.IMREAD_COLOR)
            if name.startswith("in-") or name == REF_NAME:        # 屋内(固定カメラ)と基準はそのまま
                cv2.imwrite(out_path, img)
                continue
            season = name.split("-")[0]
            f = flows.get(f"{season}-day.png")
            cv2.imwrite(out_path, warp(img, f) if f is not None else img)
            if not name.endswith("-day.png"):
                print(f"[{theme}] {name:18s} ({season}-day のワープを適用)")
        for name in sorted(os.listdir(d)):
            if name.startswith("cloud-") and name.endswith(".png"):
                t = name[len("cloud-"):-4]
                key = f"summer-{t}.png"
                img = cv2.imread(os.path.join(d, name), cv2.IMREAD_COLOR)
                cv2.imwrite(os.path.join(out, name), img)   # summer は基準なのでそのまま
                print(f"[{theme}] {name:18s} (基準の夏なのでそのまま)")


if __name__ == "__main__":
    sys.exit(main())
