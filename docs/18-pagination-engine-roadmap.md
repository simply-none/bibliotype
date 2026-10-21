# 18 纸书排版引擎路线图

> 目标：分页行为对齐纸书排版逻辑——**页是固定框、正文如水流动**（段落可在行处跨页断开、
> 有孤寡行控制、标题不落地），预览 / 编辑 / 导出三方同源。

## 市场调研结论（2026-10）

| 方案 | 定位 | 编辑态可用性 |
| --- | --- | --- |
| Paged.js / Vivliostyle | CSS Paged Media polyfill，静态分页流（页眉页脚 / 对页 / 脚注） | 不可用：重写 DOM、破坏 contenteditable；适合后续 PDF 导出管线 |
| prosemirror-pagination | `doc = page+` 页节点入数据模型 | 不可用：已停止维护；PM 作者明确反对分页入模型（页边界增删摧毁选区映射） |
| Badon Writer | 300+ 页真分页编辑器（CSS 布局、不拆节点） | 闭源；思路与本项目一致，可借鉴 |
| ProseMirror 社区共识 | 连续文档 + decorations / 占位画页边界（Google Docs 同款） | **本项目采用路线** |

结论：无可直接引入的开源编辑态分页引擎；差异化能力（CJK 行网格、古籍版式）必须自建。

## 现状与差距

`@bibliotype/layout` 分页器已具备：贪心装箱、`breakBefore` / `breakAfter`（章首 / 卷末 / h1·h2 标题另起页）、
`keepWithNext`（标题 + 首段同页）、超大块独占一页。

与纸书的差距：**块原子归属**——段落装不下时整块挪页（纸书在行处断开），且缺孤寡行控制。

## 阶段计划

- **Phase 1（已完成）编辑态止血**：`BtEditor` 横排断页尺寸改用编辑器 DOM 实时实测
  （相邻叶块顶边差），与纸张定位同源；不再依赖外部旧 `blockSizes`（仅直排 / 多栏回退）。
  纸张逐页等高，超高页随内容增高、不溢出纸外。
- **Phase 2 layout 行级拆分（已完成）**：`MeasurableBlock` 增 `lineSize` / `splittable`；
  `paginate` 输出页内片段 `items: PageItem[]`（`fromLine` / `lineCount`，未拆分时
  `lineCount=0` 按整块渲染，`blocks` 向后兼容），含孤寡行约束（`widowControl`
  首页片段 ≥ minFirst、末页片段 ≥ minLast，默认 2 / 2，不足则让行或整体换页）；
  超高块按每页可容纳行数连续拆分；`keepWithNext` 在下块可拆时仅要求头部 minFirst
  行同页。不传新字段时行为与块原子版一致（消费方接入属 Phase 3 / 4）。
- **Phase 3 预览同源**：`extractBlocks` 为正文段落输出 `splittable` + `lineSize`；
  `pagination-measure` 量尺输出扩展 `{ advance, lineSize }`；`BtBookView` 片段以
  裁剪窗口渲染（固定高 + overflow hidden + `translateY(-fromLine * lineSize)`），不拆 IR / DOM。
  直排 / 横排统一以**主轴**为口径：`MeasurePaginationResult.axis`（`'row' | 'column'`）随书写
  方向解析，`extractBlocks` 据此给可拆块标注 `MeasurableBlock.axis`，`Reader` / `buildPagedLayout`
  原样透传；分页算术只认沿主轴的尺寸，故与方向无关。
- **Phase 4 编辑态像素级对齐**：`BtEditor` 与预览共用同一 paginate 结果（含片段），
  页边界允许落在段落中间，续页片段首行按行网格对齐到下一张纸内容区首行。

## 暂缓项

- ~~直排（vertical-rl）行级拆分 = 列级拆分~~ **已落地**：量尺对直排按主轴实测列推进、
  `document-blocks` 标注 `axis: 'column'`、`MeasurePaginationResult.axis` 透传 `Reader` /
  `buildPagedLayout`；剩余为真实像素回归（happy-dom 无法验证布局盒，需浏览器用例）；
- 多栏（columns > 1）分页、对页（recto / verso）与奇偶页眉；脚注浮注已落地（`floatToBottom` / `noteArea`）；
- PDF 导出管线评估（Paged.js / Vivliostyle / 打印 CSS），与编辑态解耦；
- ~~ruby 注音导致行高不均时的实测行盒精修~~ **已落地**：量尺按基础文本矩形划分行（排除 `<rt>` 注文），
  再把注音矩形按交叉轴重叠并入所在行，产出逐行主轴尺寸 `lineMainSizes`（含直排列宽）；
  `extractBlocks` → `Reader` / `buildPagedLayout` / `exporter-pdf` 全链路透传，
  `paginate` 按行累加判页（`lineRangeMainSize`）；缺省回退均高，行为不变。
  剩余为浏览器真实像素回归（happy-dom 无布局盒）。

相关实现：`packages/layout/src/paginator.ts`、`packages/reader/src/document-blocks.ts`、
`packages/vue/src/pagination-measure.ts`、`packages/vue/src/components/BtEditor.vue`、
`packages/vue/src/components/BtBookView.vue`。

## 性能基准（I5）

根 `bench/` 提供 node 环境纯函数基准，防性能回退（用法见 `bench/README.md`）：

```bash
pnpm build        # runner 消费各包 dist ESM
pnpm bench        # 跑基准并与 bench/baseline.json 对比（劣化 >15% 失败，输出 bench/report.md）
pnpm bench:update # 跑基准并把结果写为新基线（基线带 node 版本与平台）
```

| 基准项 | 链路 | 输入 |
| --- | --- | --- |
| `layout/paginate-1000p` | `paginate` 装箱（阶段口径 `layout`） | 3000 块 × 300px，页容量 1000，混合双栏（≈1000 页） |
| `exporter-epub/epub-50ch` | `exportEpub` 打包全流程（`export`） | 50 章 × 50 段合成文档 |
| `layout/serialize-5000nodes` | `serializeNode` XHTML 序列化 | 5000 段大节点树 |

口径与约定：

- **量尺（`measure`）不进 node 基准**——离屏量尺依赖浏览器布局盒；node 基准以
  「量尺产物的消费端」（分页装箱）覆盖，浏览器侧看 demo 的 `PERF_MEASURE` 数据
  （I7 起 `getVuePerfProfiler()` 可直接出聚合报表）；
- 每项预热 1 轮弃样 + 采样 5 轮取**中位数**（`bench/lib.mjs` 的 `median`，确定性
  单测在 core `__tests__/bench-lib.test.ts`）；
- 判定只看劣化方向：相对基线劣化 **>15% 失败**（`REGRESSION_THRESHOLD`），性能
  提升永远通过；基线环境（node 版本 / 平台）不一致时警告不失败——时序跨机不可比；
- 有意优化 / 扩容后 `pnpm bench:update` 重写基线并在 changeset 说明；
- CI 不设 per-PR 时序门禁（噪声大）；可选接法：夜间任务跑 `pnpm bench` 并把
  `bench/report.md` 作为 artifact 归档，或仅在 release 分支启用。

## 性能探针与可观测（I7）

`@bibliotype/core` 新增可插拔 Profiler（替代散落的全局开关）：

- **端口**：`Profiler.span(phase, labels?)` 返回句柄 `end(extraLabels?)`；
  阶段常量 `PERF_PHASES`（`layout` / `measure` / `export` / `autosave`）与 bench
  基准共用，口径一致；
- **缺省 no-op**（`NOOP_PROFILER` / `createNoopProfiler`）：不注入零行为零开销，
  调用方可以无脑打点；
- **收集器**（`createCollectingProfiler`）：按「阶段 × 标签」聚合
  count / total / min / max / mean，`reportJson()` 出结构化报表、`reportText()`
  出对齐表格、`reset()` 清空；
- **注入点**：`paginate(opts.profiler)` 与 `exportEpub(opts.profiler)`（EPUB 按
  `step=plan / xhtml / nav-opf / zip` 细分 span）——开启后导出一次即可得到
  分阶段耗时表；
- **`PERF_*` 兼容**：vue 侧常量（`bt:layout` / `bt:measure` / `bt:save`）与
  `setPerfProbeEnabled` 语义不变；开启后埋点同步记入 `getVuePerfProfiler()`
  模块级收集器（阶段映射 `PERF_PHASES`），宿主无需自建 PerformanceObserver
  也能拿到聚合报表。

```ts
import { PERF_PHASES, createCollectingProfiler } from '@bibliotype/core';
import { exportEpub } from '@bibliotype/exporter-epub';

const profiler = createCollectingProfiler();
exportEpub(document, { profiler });
console.log(profiler.reportText()); // 阶段 × 步骤耗时表；reportJson() 可 dump 成文件
```

## 分栏与对页（P1-A 已落地）

- 分页容量按 `pageMainSize × columns` 计算，`columns` 来自章节 / 节的 `attrs.columns`（1~3），栏数变化开新页。
- 多栏量尺按栏宽实测（页宽扣栏间距后均分），不再回退字符估算。
- 对页（facing）在 `BtBookView` 渲染层实现；PDF 镜像打印与分栏符的列填充重算仍待后续批次。
