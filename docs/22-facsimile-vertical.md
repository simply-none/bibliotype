# 22 古籍仿真直排

> 一句话：**「古籍直排」是现代书籍的竖排方式，「古籍仿真直排」按木刻古籍的真实版式排版**——版框、界行、版心（书口）、天头地脚比例、字距行距与行款。两者并列，前者行为不变。

## 1. 两条并列能力线

| | 古籍直排（既有） | 古籍仿真直排（本篇） |
| --- | --- | --- |
| 定位 | 现代书籍的竖排右起 | 木刻 / 抄本古籍的版式仿真 |
| 布局字段 | `CLASSICAL_LAYOUT_OPTIONS`（无 `facsimile`） | `LayoutOptions.facsimile` 非空 |
| 版框 | 令牌 `page-border`（页面 border，**侵占版心**） | 装饰图层 `::before`（画在页边距内，**不侵占版心**） |
| 界行 | 无 | `::after` + `repeating-linear-gradient`，节距 = 字号 × 行距 |
| 版心 | 无 | `.bt-page-gutter`（书名 / 篇卷 / 叶次 + 鱼尾 + 黑口） |
| 页码 | 页脚 | 版心竖写叶次（页脚页码自动隐藏） |
| 样式表 | 不变 | 仅 `pageDecoration` 开启时追加装饰段 |
| 分页 | 不变 | 仅版心带宽进入主轴扣减 |

**零影响红线**：`LayoutOptions.facsimile` 缺省为 `undefined`，`isFacsimileEnabled` 是唯一判定入口。未启用时 `buildBookCss` 产物、`resolvePageMainSize` / `CrossSize` 数值、`computeMetricsSignature` 字符串与改造前逐字符 / 逐数值相同（由 `packages/layout/src/__tests__/classical-isolation.test.ts` 守护）。

## 2. 数据模型

```ts
interface LayoutOptions {
  // …既有字段
  facsimile?: FacsimileOptions;   // 缺省 undefined = 未启用
}

interface FacsimileOptions {
  preset: string;                 // 模板 id，'custom' 表示手改
  frame: 'none' | 'single' | 'double' | 'left-right';
  rule: 'none' | 'ink' | 'vermilion';
  gutter?: {
    side: 'left' | 'right';       // v1 恒定一侧（单页视图折口固定）
    size: number;                 // 带宽 px，唯一进主轴的量
    mouth: 'white' | 'black';
    fishTail: 'none' | 'single' | 'double';
    fields: PageChromeField[];    // 默认 [bookTitle, chapterTitle, pageNumber]
  };
}
```

几何全部由 `facsimile-geometry.ts` 纯函数换算（无 DOM 依赖）：

| 量 | 口径 |
| --- | --- |
| 列距 `linePitch` | 字号 × 行距（直排下 `line-height` 即列距，与 PDF `defaultLineSize` 同源） |
| 版框内缩 | 页边距 − 线宽（外缘落在页边距内、内缘贴住版心） |
| 界行区域 | 页边距，版心侧再加带宽 |
| 每半页行数 | floor(（版心宽 − 带宽）÷ 列距) |
| 每行字数 | floor(版心高 ÷（字号 × (1 + 字距 em))) |

## 3. 模板

`FACSIMILE_PRESETS` 六个模板（纯数据，顺序即面板顺序，`[0]` 为默认）：

| # | id | 名称 | 开本 | 字号/行距/字距 | 页边距 上右左下 | 带宽 | 版框 | 界行 | 口子·鱼尾 | 行款 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `song-zhe` | 宋刻浙本 | FOLIO_16 | 22px/1.95/0.02em | 200/120/173/90 | 34 | 四周双边 | 乌丝栏 | 白口·单鱼尾 | 10 行 × 27 字 |
| 2 | `ming-jiajing` | 明嘉靖本 | FOLIO_16 | 21px/1.75/0.02em | 186/116/168/86 | 30 | 四周单边 | 乌丝栏 | 白口·单鱼尾 | 12 行 × 29 字 |
| 3 | `qing-dianben` | 清武英殿本 | DACHU_16 | 25px/1.85/0.03em | 170/120/140/82 | 38 | 四周双边 | 乌丝栏 | 白口·单鱼尾 | 11 行 × 29 字 |
| 4 | `jiguge` | 汲古阁本 | FOLIO_16 | 20px/1.70/0.02em | 172/100/150/72 | 28 | 左右双边 | 乌丝栏 | 细黑口·单鱼尾 | 14 行 × 32 字 |
| 5 | `zhushilan` | 朱丝栏抄本 | FOLIO_16 | 23px/2.00/0.04em | 150/110/120/74 | 36 | 四周双边（朱） | 朱丝栏 | 无鱼尾 | 10 行 × 29 字 |
| 6 | `jinxiang` | 巾箱本 | FOLIO_32 | 15px/1.85/0.01em | 96/66/74/42 | 24 | 四周单边 | 乌丝栏 | 细黑口·单鱼尾 | 12 行 × 34 字 |

行款由 `resolveFacsimileGrid` 推导，并由 `facsimile-presets.test.ts` 锁定——**改模板数值必须同时改本篇表格与测试断言**。

## 4. 扩展令牌

| 令牌 | 作用 | 缺省 |
| --- | --- | --- |
| `page-frame-color` | 版框颜色 | `#3b322a` |
| `page-frame-width` | 外框线宽 | `2px` |
| `page-frame-inner-gap` | 双边间距 | `3px` |
| `page-frame-inner-width` | 内框线宽 | `1px` |
| `page-rule-color` | 界行颜色 | `#3b322a` |
| `gutter-color` | 版心文字 / 鱼尾颜色 | `#3b322a` |
| `font-family-classical-song` | 宋体族（`FACSIMILE_FONT_TOKENS.SONG`） | 模板给出 |
| `font-family-classical-fangsong` | 仿宋族（`FACSIMILE_FONT_TOKENS.FANGSONG`） | 模板给出 |

颜色 / 线宽 / 纸纹属纯绘制令牌，**不进度量签名**；`facsimile.gutter.size` 与两个字体族令牌进签名。

## 5. 三端渲染

| 路径 | `pageDecoration` | 版心注入 | 说明 |
| --- | --- | --- | --- |
| 阅读 `BtBookView` | `layout.facsimile !== undefined` | `reader.getPageGutterTexts()` + `serializePageGutter` | 翻页与滚动两种模式都注入 |
| 编辑分页 `PagedCanvas` | 同上 | 同源序列化，页级缓存 | 装饰为绝对定位伪元素，不影响点击定位 |
| 打印 `renderPrintHtml` | 仅 `mode === 'paged'` 且带 `facsimile` | 同源序列化 | `auto` 交给打印引擎重排，不加装饰 |
| EPUB | 不传 | 不注入 | reflow 无固定分页 |
| 连续编辑 `BtEditor` / 量尺 | 不传 | — | 避免装饰干扰点选与测量 |

样式表闸门为三重与：`pageDecoration === true` **且** `facsimile !== undefined` **且** 直排。

## 6. 设置面板

设置 →「古籍仿真」：

- **版式模板**：六个芯片，进入「古籍仿真直排」主题时默认套用第一个（宋刻浙本）；
- **细节可调**：版框形态 / 界行 / 版心开关 / 口子 / 鱼尾 / 带宽 / 版心字段；
- **行款回显**：每半页 N 行 × 每行 M 字（由当前字号行距边距实时推导）；
- **已修改态**：与模板基准深比较（版式字段 + 字号/行距/字距/页边距），显示「已修改，基于 X」，可一键「恢复模板默认」。

模板令牌由 `resolveFacsimilePreset(id).tokens` **派生**合并（`theme.tokens → preset.tokens → tokenPatch → night`），不写入令牌补丁——因此从仿真切回「古籍直排」不会残留纸色 / 字体 / 框色。

## 7. 已知限制

1. **字体**：仓库不打包字体文件，模板只给系统字体栈，缺失回退 `Noto Serif CJK SC` / `serif`；
2. **版框双边**用 CSS `border-style: double` 绘制（≥3px 才出双线），三段等分，不严格等于「外 2px / 间距 3px / 内 1px」的令牌比例——令牌只决定总厚度；
3. **版心恒在左侧**（`side` 可改右，但同页不交替）：单页视图折口固定，分页因此与奇偶解耦；
4. **混排块可能破坏行款**：标题 / 注文若带 block 外边距，会把后续列推离界行节距，模板已尽量归零，复杂混排需自行用功能样式覆写；
5. **直排 `columns > 1` 不适用**：CSS 多栏在 `vertical-rl` 下沿 inline 轴（纵向）分栏，与古籍「列」不是一回事，仿真模板固定单栏。
