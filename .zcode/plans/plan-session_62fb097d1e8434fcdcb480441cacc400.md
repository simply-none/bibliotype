# 古籍仿真版式模板：历史考证修正 + 扩充至十二种（已批准——只执行代码，demo 浏览验证由用户执行）

遵循开发规范（最小改动、行为改动配测试与文档、changeset、不自提交）。改动集中在 `packages/layout`。

## 一、现存六模板考证修正

| 模板 | 修正 |
|---|---|
| 宋刻浙本 | frame→`left-right`；fishTail→`double`；字体→楷体栈（欧体替身）；行款→10行×20字 |
| 明嘉靖本 | frame→`left-right`；fishTail→`double` |
| 清武英殿本 | 字体→宋体栈（匠体）；行款→9行×21字 |
| 汲古阁本 | 保留；行款微调至 12行×25字 |
| 朱丝栏抄本 | 不动 |
| 巾箱本 | fishTail→`double`；frame→`left-right` |

行款反推法：`字号 ≈ 版心高/(字数×(1+字距))`、`行距 ≈ 版心宽/行数/字号`，保留各模板页型与边距风格。

## 二、实现层缺口修复

1. 双鱼尾相向：`facsimile-frame-css.ts` 下鱼尾 `transform: scaleY(-1)`。
2. 大黑口：`GUTTER_MOUTHS.BLACK_WIDE: 'black-wide'`（象鼻段 ≈14px 宽黑条）；demo 口子下拉同步。

## 三、新增六种模板

元刻本（大黑口·双鱼尾·四周双边·楷体·12×24·竹纸微黄）· 宋建本麻沙本（细黑口·双黑鱼尾·四周双边·宋体·13×26·竹纸黄褐）· 宋蜀刻大字本（白口·左右双边·单鱼尾·楷体·8×16·皮纸洁白）· 明万历本（白口·双鱼尾·四周双边·瘦长宋体·12×26·白棉纸）· 清写刻本（白口·左右双边·单鱼尾·软体楷书·9×20·开化纸莹白）· 四库馆写本（朱丝栏·四周双边·无鱼尾·楷书·8×21·白纸红栏）。

## 四、改动文件

1. `packages/layout/src/facsimile.ts` — `BLACK_WIDE`；
2. `packages/layout/src/html/facsimile-frame-css.ts` — 大黑口渲染 + 双鱼尾翻转；
3. `packages/layout/src/facsimile-presets.ts` — 修正 4 种 + 新增 6 种；
4. 测试 — `facsimile-presets.test.ts`（12 个、行款表）、`facsimile-style.test.ts`（大黑口、鱼尾翻转）；
5. `docs/22-facsimile-vertical.md` + changeset（`@bibliotype/layout` minor）；
6. demo 口子下拉同步。

## 五、验证

仅代码级：`pnpm build && pnpm test && pnpm typecheck`；demo 浏览目验由用户执行。