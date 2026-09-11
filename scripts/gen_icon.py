"""生成 build/icon.ico —— J.A.R.V.I.S 反应炉图标（深蓝实底，多尺寸）。

背景（aceFelix）：electron-builder.yml 的 win.icon 与 tray.ts 的兜底路径都
引用 build/icon.ico，但该文件此前一直缺失（electron-builder 打包必报错、
托盘在 ~/.jarvis/jarvis_window.ico 不存在时无图标）。本脚本复用上游 jarvis
仓库 agent/daemon/autostart.py 的 _draw_reactor_icon/_save_ico（单一图案
来源，避免两处维护），一次性生成入库。

用法（需 jarvis 的 Python 环境已装 Pillow，仓库默认在 ../jarvis）：

    python scripts/gen_icon.py

可用环境变量 JARVIS_REPO 覆盖 jarvis 仓库路径。

@author aceFelix
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "build" / "icon.ico"


def resolve_jarvis_repo() -> Path:
    """定位 jarvis 源码仓库：JARVIS_REPO 环境变量 → 同级 ../jarvis。"""
    env = os.environ.get("JARVIS_REPO", "")
    if env:
        return Path(env).resolve()
    return (REPO_ROOT.parent / "jarvis").resolve()


def main() -> int:
    repo = resolve_jarvis_repo()
    if not (repo / "agent" / "daemon" / "autostart.py").exists():
        print(f"[gen_icon] 找不到 jarvis 仓库: {repo}（用 JARVIS_REPO 指定）")
        return 1

    # 复用 jarvis 的反应炉绘制逻辑（导入失败通常意味着缺 Pillow）
    sys.path.insert(0, str(repo))
    try:
        from agent.daemon.autostart import _draw_reactor_icon, _save_ico
    except ImportError as e:
        print(f"[gen_icon] 导入失败（请确认 jarvis 环境已装 Pillow）: {e}")
        return 1

    # 深蓝实底：与窗口/任务栏图标同口径，避免浅色底透出白色
    img = _draw_reactor_icon(solid_bg=(8, 18, 32))
    if img is None:
        print("[gen_icon] 绘制失败（Pillow 不可用）")
        return 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not _save_ico(img, OUT_PATH):
        print(f"[gen_icon] 保存失败: {OUT_PATH}")
        return 1

    print(f"[gen_icon] 已生成 {OUT_PATH}（{OUT_PATH.stat().st_size} bytes，多尺寸 16~256）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
