#!/usr/bin/env python3
"""編集前(REF)と編集後(CAND)で、建物の輪郭がどれだけ動いたか(小さいほど形が保たれている)。
街並みの帯(画像の上 45%〜80%)にある強い輪郭だけを比べる。昼夜で見た目が違っても残る「形」(局所コントラスト正規化)で比べる。
  .venv/bin/python tools/score.py REF.png CAND.png [y0 y1]
"""
import sys
import cv2
import numpy as np


def structure(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.4)
    mu = cv2.GaussianBlur(g, (0, 0), 10)
    d = g - mu
    sd = np.sqrt(cv2.GaussianBlur(d * d, (0, 0), 10)) + 5.0
    return np.clip(d / sd * 42 + 128, 0, 255).astype(np.uint8)


def edges(img):
    s = cv2.GaussianBlur(structure(img), (0, 0), 1.0)
    return cv2.Canny(s, 70, 150)


def main():
    ref = cv2.imread(sys.argv[1]); cand = cv2.imread(sys.argv[2])
    cand = cv2.resize(cand, (ref.shape[1], ref.shape[0]))
    h = ref.shape[0]
    y0 = int(sys.argv[3]) if len(sys.argv) > 3 else int(h * 0.45)
    y1 = int(sys.argv[4]) if len(sys.argv) > 4 else int(h * 0.80)
    er, ec = edges(ref)[y0:y1], edges(cand)[y0:y1]
    dr = cv2.distanceTransform(255 - er, cv2.DIST_L2, 3); dc = cv2.distanceTransform(255 - ec, cv2.DIST_L2, 3)
    # 双方向(候補の輪郭が参照から遠い + 参照の輪郭が候補から遠い)。大きな外れ値を重くする
    a = np.minimum(dr[ec > 0], 20); b = np.minimum(dc[er > 0], 20)
    print(f"{(a.mean() + b.mean()) / 2:.3f}")


if __name__ == "__main__":
    main()
