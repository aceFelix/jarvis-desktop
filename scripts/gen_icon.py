"""生成 build/icon.ico —— 复古荧光绿像素反应炉图标（多尺寸 16~256）。

背景（aceFelix）：桌面壳默认主题改为复古 CRT 荧光绿后，应用图标同步换身份——
圆形反应炉以 32×32 像素网格程序化绘制（同心环带 + 八扇区线圈 + 高光内核），
再 NEAREST 放大出各尺寸帧，保持像素颗粒感；配色与 theme-retro.css 同源。
本脚本自包含（仅依赖 Pillow），不再复用 jarvis 仓库 autostart.py 的深蓝反应炉
绘制——两者身份有意分叉：jarvis --gui 窗口仍用深蓝版（~/.jarvis/
jarvis_window.ico，仅兜底），桌面壳用本仓库复古版且候选优先（src/main/appIcon.ts）。

用法（任一装了 Pillow 的 Python 环境，如 jarvis 的 venv）：

    python scripts/gen_icon.py

@author aceFelix
"""

from __future__ import annotations

import io
import math
import struct
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "build" / "icon.ico"

GRID = 32               # 像素画布网格（32×32），放大后呈像素颗粒
CENTER = (GRID - 1) / 2  # 圆心（15.5, 15.5）
SIZES = (16, 24, 32, 48, 64, 128, 256)

# 复古荧光绿配色（与 theme-retro.css 同源）；实底背景避免任务栏发白
BG = (2, 6, 2)          # #020602 黑绿实底
RING = (51, 255, 102)   # #33ff66 外环荧光绿
COIL = (102, 255, 153)  # #66ff99 线圈/内核中绿
CORE = (200, 255, 214)  # #c8ffd6 内核高光
GAP = (6, 43, 18)       # #062b12 暗绿间隙（CRT 暗槽，非纯黑）


def pixel_at(x: int, y: int) -> tuple[int, int, int]:
    """按半径环带 + 八扇区交替线圈决定单像素颜色（程序化像素画）。"""
    dx, dy = x - CENTER, y - CENTER
    r = math.hypot(dx, dy)
    if r > 15.0:
        return BG
    if r > 12.5:
        return RING  # 外环
    if r > 10.5:
        return GAP  # 外环与线圈间暗槽
    if r > 7.5:
        # 八扇区（每 45°）交替：线圈亮弧与暗槽相间，反应炉线圈观感
        sector = int((math.atan2(dy, dx) + math.pi) / (math.pi / 4)) % 8
        return COIL if sector % 2 == 0 else GAP
    if r > 5.5:
        return GAP  # 线圈与内核间暗槽
    return CORE if r <= 2.5 else COIL  # 内核高光 + 中绿内圈


def render_base() -> Image.Image:
    """绘制 32×32 基准像素图（RGBA，不透明实底）。"""
    img = Image.new("RGBA", (GRID, GRID), BG + (255,))
    px = img.load()
    for y in range(GRID):
        for x in range(GRID):
            px[x, y] = pixel_at(x, y) + (255,)
    return img


def save_ico(frames: list[Image.Image], path: Path) -> None:
    """手写 ICO 容器：每帧为独立 PNG（像素放大已在帧上完成）。

    Pillow 的 ICO 保存插件会过滤掉大于源图的尺寸并内部平滑缩放，
    破坏像素颗粒；自写容器（6 字节头 + 每帧 16 字节目录 + PNG 帧数据，
    Vista+ 支持 PNG 压缩帧）可逐帧保留 NEAREST 放大结果。
    """
    blobs = []
    for fr in frames:
        buf = io.BytesIO()
        fr.save(buf, format="PNG")
        blobs.append(buf.getvalue())
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries = b""
    for fr, blob in zip(frames, blobs):
        w, h = fr.size  # 256 按 ICO 规范记 0
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(header + entries + b"".join(blobs))


def main() -> int:
    base = render_base()
    # 每尺寸独立 NEAREST 放大：ICO 各帧自带像素颗粒，小尺寸任务栏也保持硬边
    frames = [base.resize((s, s), Image.Resampling.NEAREST) for s in SIZES]
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    save_ico(frames, OUT_PATH)
    size_txt = "、".join(str(s) for s in SIZES)
    print(f"[gen_icon] 已生成 {OUT_PATH}（{OUT_PATH.stat().st_size} bytes，尺寸 {size_txt}，复古像素反应炉）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
