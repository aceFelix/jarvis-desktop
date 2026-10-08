# 桌面壳打包发布（PyInstaller 冻结后端 + NSIS 安装包）迭代复盘

> 二期首发：把「依赖本机 jarvis 源码仓库」的 dev 壳，升级成「下载双击即装、无需 Python」
> 的 Windows NSIS 安装包。作者 aceFelix。

## 1. 目标与方案选型

诉求：让别人通过下载安装程序完成 App 安装。桌面壳本身（Electron）打包容易，硬骨头是
**Python 后端如何随包分发**。三条路线权衡后选定 **方案 A：PyInstaller 冻结后端**（项目
文档既定的二期目标），首发 **仅 Windows、未签名**：

- A. PyInstaller 把 `agent.serve` 冻结成独立 `jarvis-serve.exe`，`extraResources` 随包分发。
  体验最好（用户无需 Python），核心依赖干净、重型可选包（playwright/cv2/mediapipe/paddleocr）
  不打包即可，规避大部分坑。✔ 选定
- B. 内置便携 Python + 安装期 pip 装 jarvis-agent。
- C. 只打壳，后端要求用户自己 pip 装（达不到「下载即用」）。

## 2. 落地改动

### jarvis（Python 侧，新增 `packaging/`）

- `serve_entry.py`：等价 `python -m agent.serve` 的显式入口（加载 settings → 恢复 last_active
  项目目录 → `run_serve`）。之所以不直接冻结 `__main__.py`：PyInstaller 需明确脚本入口，且
  `if __name__=="__main__"` 守卫在被收集时不执行。
- `jarvis-serve.spec`：PyInstaller **onedir** 规格。要点：
  - `collect_submodules('agent')` 全量收集动态 import 的工具/命令；
  - `datas` 仅带 `agent/configs`（示例模板 + `permissions.yaml`），**绝不带 repo 根 `configs/`**
    （开发者实盘配置，含密钥）；用户配置首启生成于 `~/.jarvis/`；
  - `console=True`：serve 靠 stdout 打单行握手 JSON，必须控制台子系统（spawn 时 windowsHide 隐藏）；
  - `excludes` 剔除 playwright/cv2/mediapipe/paddleocr/paddle/onnxruntime（可选 extras，工具懒加载
    try/except 降级）——产物从 **301MB → 99.7MB**；
  - keyring/websockets 装了才补 hiddenimport，未装跳过。
- `build_serve.ps1`：一键冻结（自动定位 venv Python、缺 PyInstaller 即时装）。
  **踩坑**：Windows PowerShell 5.1 把无 BOM 的 UTF-8 按系统码页（GBK）读，中文注释/全角字符
  导致解析失败——脚本改**纯 ASCII**。

### jarvis-desktop（Electron 侧）

- `backend.ts`：新增纯函数 `resolveLaunchPlan({env, appDir, isPackaged, resourcesPath})`，统一
  决策三种启动模式（优先级：`JARVIS_SERVE_EXE` 显式 exe → 打包内置 `resources/jarvis-serve/
  jarvis-serve.exe` → dev `python -m agent.serve`）。`start()` 改用之，存在性校验按 `mode` 分开
  （dev 验仓库、exe 验内置后端），错误提示按模式区分（打包态不再误导用户装 Python）。保留
  `resolvePythonEnv` 兼容既有测试。
- `index.ts`：`createBackendManager` 注入 `isPackaged: app.isPackaged` 与 `process.resourcesPath`；
  启动失败弹窗按打包态给「重装/查杀软」指引。
- `electron-builder.yml`：win target `dir` → `nsis`；新增 `extraResources`（`../jarvis/dist/jarvis-serve`
  → `jarvis-serve`）；NSIS 配置（oneClick false、可改安装目录、桌面/开始菜单快捷方式）；
  **`asar: false`**。
- `package.json`：新增 `serve:build` / `dist` / `dist:fast` 脚本。

## 3. 端到端验证

- PyInstaller 冻结产物 stdout 正常打 `{"type":"jarvis-serve-ready",...}`，stderr 无 ImportError。
- 桌面单测：`backend.ts` 新增 `resolveLaunchPlan`（4 例）+ 打包态 BackendManager spawn exe（2 例），
  typecheck 0 错、全量 **378 passed**。
- **win-unpacked 实跑**：启动 `dist/win-unpacked/JARVIS Desktop.exe`（`app.isPackaged=true`），日志
  `拉起后端: ...resources\jarvis-serve\jarvis-serve.exe` → `后端就绪: ws_port=... pid=...`，MCP 全部
  连上。证明「冻结 + extraResources + 打包态 spawn」集成层完全跑通。

## 4. 两个 Windows 环境卡点（非配置 bug）

1. **addWinAsarIntegrity → UNKNOWN**：electron-builder 向新建的 electron exe 回写 asar 完整性时，
   `writeFile` 被 Windows Defender 实时扫描写锁命中。→ `asar: false` 关闭 asar，不计算 asarIntegrity，
   绕过该回写（`ElectronFramework` 仅在 `options.asarIntegrity` 存在时调 addWinAsarIntegrity）。
2. **winCodeSign 符号链接权限**：electron-builder 拉取 `winCodeSign` 依赖包时需解压包内 macOS
   `.dylib` 符号链接，普通账户缺 `SeCreateSymbolicLinkPrivilege` 报「客户端没有所需的特权」，
   7z 非零退出使 NSIS 步骤中止。`CSC_IDENTITY_AUTO_DISCOVERY=false` 也不足以跳过（该包被无条件获取）。
   解决任选其一：① 开启 **Windows 开发者模式**；② **以管理员身份**运行构建；③ 在 **CI
   GitHub Actions windows-latest** 上构建（自带权限，最适合发布）。`win-unpacked/` 不受此限，已在
   本机产出并验证；差的只是最终 `.exe` 封装这一步的权限。

## 5. 国内网络

electron-builder 从 github 下载 Electron 运行时与自身二进制会失败。设镜像：
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。

## 6. CI 首跑（windows-latest，2026-10-08）

推 `v0.1.0` tag 首跑，**打包链路全绿**：`build` → PyInstaller 冻结 `jarvis-serve.exe`（双仓并列
checkout 下 `pip install -e .` 正常）→ electron-builder 下载 `winCodeSign`/`nsis` **无权限报错**（印证了
第 4 节：CI runner 自带符号链接权限）→ 成功产出 `dist/JARVIS Desktop-Setup-0.1.0.exe` + blockmap。

**唯一致败点**：末尾 `⨯ GitHub Personal Access Token is not set ... GH_TOKEN`。根因：electron-builder
检测到 tag 构建会自动启用**内置 GitHub 发布器**（日志 `artifacts will be published reason=tag is defined`），
与 workflow 里 `softprops/action-gh-release` 两套发布器重叠、前者缺 `GH_TOKEN` 而失败。
**修复**：`electron-builder.yml` 加 `publish: null` 关掉自带发布器，Release 上传统一交给 softprops 步骤
（用内置 `GITHUB_TOKEN` + `permissions: contents: write`）。改动后重打 tag 即出可下载安装包。

## 7. 后续

- ✅ **CI 出包已配置**（`.github/workflows/release.yml`，2026-10）：`windows-latest` 上并列检出
  `jarvis-desktop` + `jarvis`（默认 `master`）、装 Node 20 + Python 3.12（`pip install -e .` + `pyinstaller`）、
  `npm run dist` 出包，再用 `softprops/action-gh-release` 把 `*-Setup-*.exe` 挂到对应 tag 的 GitHub
  Release。推 `v*` tag（或手动 `workflow_dispatch`）即触发——彻底绕开本机 `winCodeSign` 符号链接权限
  卡点，并顺带解决「上传」诉求。（若 `jarvis` 为私有仓，需配 `JARVIS_REPO_TOKEN` Secret 供跨仓 checkout。）
- 代码签名消除 SmartScreen「未知发布者」提示 → 接 `electron-updater` 自动更新。
- macOS / Linux 包（mac 需签名 + 公证）。
