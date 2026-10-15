# 跨仓链接写成 `../..`：指向兄弟仓 jarvis 的链接落回本仓仓根 —— 修复复盘

- 日期：2026-10-15
- 仓库：jarvis-desktop（由 jarvis 侧文档死链门禁查出）
- 作者：aceFelix

## 一、问题现象

`docs/guide/installation.md` 的「前置条件」段落写着：

```markdown
`jarvis-desktop` 与 [`jarvis`](../..) 是**上下游分离**的两个仓库
```

在 GitHub 页面上点击这个 `jarvis` 链接，跳转到的是 **jarvis-desktop 自己的仓库首页**，
而不是它想指的上游仓 jarvis。

## 二、排查过程

1. **发现方式**：本次不是人工点出来的，是被 jarvis 仓新增的门禁扫出来的。
   jarvis 的 `scripts/check_md_links.py` 补上「链接目标必须已入 git」这一维判定后，
   拿它扫本仓（`uv run python scripts/check_md_links.py ..\jarvis-desktop`），
   本条即作为异常链接被列出。
2. **按路径算一遍**：`docs/guide/installation.md` 所在目录是 `docs/guide/`，
   `../..` 上跳两层正好落在**本仓仓根**，仓根目录恒存在，所以「文件是否存在」类
   检查永远不会报错——这是个只有算路径才会暴露的语义错误。
3. **核对既有写法**：本仓其他文档引用上游 jarvis 一律走 `../../../jarvis/...`
   （指向工作区里的兄弟目录，GitHub 上不可点）或直接写 GitHub 地址。对读者而言，
   GitHub 地址才是真正可达的链接。

## 三、根因分析

写文档时把「上一级仓」当成了 `../..`，少算了一层：跨出本仓需要 `../../..`
（`docs/guide/` → `docs/` → 仓根 → 工作区），而 `../..` 恰好停在仓根。

**为什么一直没被发现**：本仓 CI 只跑 `typecheck / test / build`，没有任何链接有效性
门禁；而"存在性"检查对目录链接天然无效——仓根永远存在。

## 四、修复方案

`docs/guide/installation.md` 的链接目标改为 `https://github.com/aceFelix/jarvis`，
与本仓其他引用上游的写法一致，且在 GitHub 页面、本地编辑器、任意检出环境下都可达。

不采用「改成 `../../../jarvis/README.md`」的原因：那要求读者把两个仓放在同一父目录
下克隆，对外部贡献者是坏链接。

## 五、验证结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| 死链门禁扫本仓 | `uv run python scripts/check_md_links.py ..\jarvis-desktop`（在 jarvis 仓内执行） | 13 md / 判定 66 / 跳过 28 / 死链 0 / 未入库链接 0 |
| 门禁工具自身用例 | `uv run pytest tests/test_md_link_checker.py -q`（jarvis 仓） | 17 passed |
| 本仓构建回归 | 纯文档改动，不涉及 ts/tsx，无需 typecheck/build | — |

> 说明：外链（`http(s)://`）按门禁口径不参与存在性判定，因此改后该条从"需判定"
> 移入"跳过"统计，本仓判定数由 67 降为 66、跳过由 27 升为 28。

## 六、涉及文件

| 文件 | 改动说明 |
|---|---|
| `docs/guide/installation.md` | `[jarvis](../..)` → `[jarvis](https://github.com/aceFelix/jarvis)` |
| `docs/fixlogs/cross-repo-link-installation-fix.md` | 本篇复盘 |
| jarvis 仓 `scripts/check_md_links.py` 等 | 新增未入库链接门禁（详见 jarvis 仓 `docs/fixlogs/md-link-checker-untracked-link-fix.md`） |

## 七、经验总结

1. **指向仓根的相对链接是检查盲区**：`../..`、`..` 这类目标恒为"存在的目录"，
   任何基于存在性的门禁都抓不到它写错了指向。跨仓引用优先写 GitHub 地址，
   既避免层数算错，也让链接在网页上真的能点。
2. **相对路径层数要按"起点目录"算，不是按"直觉"**：`docs/guide/` 出发，出仓需要三层。
3. **门禁工具的覆盖面要跨仓复用**：本次是上游仓的工具查出下游仓的文档缺陷，
   说明"工具放在其中一个仓"不等于"只保护那一个仓"；扫描根可作为参数传入。
