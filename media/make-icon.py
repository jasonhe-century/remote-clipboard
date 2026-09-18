#!/usr/bin/env python3
"""生成 media/icon.png（Marketplace 用的 128x128 图标）。

以 4 倍尺寸绘制再降采样，换来干净的抗锯齿边缘。
    python3 media/make-icon.py
"""
from PIL import Image, ImageDraw

SCALE = 4
SIZE = 128 * SCALE
BG_TOP = (79, 70, 229)      # indigo-600
BG_BOTTOM = (124, 58, 237)  # violet-600
ACCENT = (79, 70, 229)
WHITE = (255, 255, 255)


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def gradient(size, top, bottom):
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        draw.line(
            [(0, y), (size[0], y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return img


def main():
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bg = gradient((SIZE, SIZE), BG_TOP, BG_BOTTOM).convert("RGBA")
    canvas.paste(bg, (0, 0), rounded_mask((SIZE, SIZE), 26 * SCALE))

    draw = ImageDraw.Draw(canvas)
    u = SCALE  # 1 个图标像素

    # 剪贴板板身
    draw.rounded_rectangle([26 * u, 30 * u, 102 * u, 112 * u], radius=9 * u, fill=WHITE)
    # 顶部的夹子
    draw.rounded_rectangle([50 * u, 18 * u, 78 * u, 38 * u], radius=6 * u, fill=WHITE)
    draw.rounded_rectangle([56 * u, 24 * u, 72 * u, 33 * u], radius=3 * u, fill=BG_TOP)

    # 板身里的"图片"字形：相框 + 太阳 + 山
    frame = [38 * u, 50 * u, 90 * u, 92 * u]
    draw.rounded_rectangle(frame, radius=5 * u, outline=ACCENT, width=3 * u)
    draw.ellipse([46 * u, 57 * u, 56 * u, 67 * u], fill=ACCENT)
    draw.polygon(
        [(41 * u, 89 * u), (60 * u, 68 * u), (72 * u, 80 * u), (79 * u, 73 * u), (87 * u, 89 * u)],
        fill=ACCENT,
    )
    # 把山盖出框的部分裁回相框内
    draw.rectangle([38 * u, 89 * u, 90 * u, 92 * u], fill=WHITE)
    draw.rounded_rectangle(frame, radius=5 * u, outline=ACCENT, width=3 * u)

    icon = canvas.resize((128, 128), Image.LANCZOS)
    out = __file__.rsplit("/", 1)[0] + "/icon.png"
    icon.save(out, "PNG", optimize=True)
    print("已生成", out, icon.size)


if __name__ == "__main__":
    main()
