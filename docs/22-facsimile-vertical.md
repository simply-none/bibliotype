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

`FACSIMILE_PRESETS` 十二个模板（纯数据，顺序即面板顺序，`[0]` 为默认），形态 / 字体 / 行款经历史考证校准（宋代左右双边白口居多；嘉靖本左右双边双顺鱼尾；元刻本大黑口双鱼尾赵体；殿本宋体匠字九行二十一字等）：

| # | id | 名称 | 开本 | 字号/行距/字距 | 页边距 上右下左 | 带宽 | 版框 | 界行 | 口子·鱼尾 | 行款 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `song-zhe` | 宋刻浙本 | FOLIO_16 | 29px/1.55/0.02em | 200/120/173/90 | 34 | 左右双边 | 乌丝栏 | 白口·双鱼尾 | 10 行 × 20 字 |
| 2 | `song-jian` | 宋建本（麻沙本） | FOLIO_16 | 26px/1.54/0.02em | 150/88/130/64 | 26 | 四周双边 | 乌丝栏 | 细黑口·双鱼尾 | 13 行 × 26 字 |
| 3 | `song-shu` | 宋蜀刻大字本 | FOLIO_16 | 36px/1.57/0.02em | 210/120/180/92 | 34 | 左右双边 | 乌丝栏 | 白口·单鱼尾 | 8 行 × 16 字 |
| 4 | `yuan-ke` | 元刻本 | FOLIO_16 | 27px/1.55/0.02em | 160/96/140/70 | 30 | 四周双边 | 乌丝栏 | 大黑口·双鱼尾 | 12 行 × 24 字 |
| 5 | `ming-jiajing` | 明嘉靖本 | FOLIO_16 | 34px/1.52/0.02em | 186/116/168/86 | 30 | 左右双边 | 乌丝栏 | 白口·双鱼尾 | 9 行 × 18 字 |
| 6 | `ming-wanli` | 明万历本 | FOLIO_16 | 27px/1.68/0.02em | 165/100/145/72 | 28 | 四周双边 | 乌丝栏 | 白口·双鱼尾 | 11 行 × 24 字 |
| 7 | `jiguge` | 汲古阁本 | FOLIO_16 | 25px/1.66/0.02em | 172/100/150/72 | 28 | 左右双边 | 乌丝栏 | 细黑口·单鱼尾 | 12 行 × 25 字 |
| 8 | `qing-dianben` | 清武英殿本 | DACHU_16 | 35px/1.75/0.03em | 170/120/140/82 | 38 | 四周双边 | 乌丝栏 | 白口·单鱼尾 | 9 行 × 21 字 |
| 9 | `qing-xieke` | 清写刻本 | FOLIO_16 | 30px/1.70/0.02em | 195/118/168/88 | 32 | 左右双边 | 乌丝栏 | 白口·单鱼尾 | 9 行 × 20 字 |
| 10 | `qing-siku` | 四库馆写本 | DACHU_16 | 34px/2.10/0.02em | 185/110/150/78 | 34 | 四周双边（朱） | 朱丝栏 | 白口·无鱼尾 | 8 行 × 21 字 |
| 11 | `zhushilan` | 朱丝栏抄本 | FOLIO_16 | 23px/2.00/0.04em | 150/110/120/74 | 36 | 四周双边（朱） | 朱丝栏 | 无鱼尾 | 10 行 × 29 字 |
| 12 | `jinxiang` | 巾箱本 | FOLIO_32 | 17px/1.62/0.01em | 96/66/74/42 | 24 | 左右双边 | 乌丝栏 | 细黑口·双鱼尾 | 13 行 × 30 字 |

字体按历史归属：宋刻浙本 / 蜀刻大字本 / 元刻本 / 清写刻本 / 四库馆写本 / 朱丝栏抄本用楷体栈（欧体 / 赵体 / 软体楷书的现代替身）；建本 / 万历本 / 汲古阁 / 殿本 / 巾箱本用宋体栈（匠体替身）；嘉靖本用仿宋栈。双鱼尾上下**相向**（下鱼尾垂直镜像）；口子支持白口 / 细黑口（5px 象鼻线）/ 大黑口（14px 象鼻条，元刻本标志）。未纳入：装帧形态（经折 / 蝴蝶 / 包背装）、朱墨套印本（需双色正文渲染，列为后续）。

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
| `page-texture` | 纸纹图层（原样作为 `background-image`，渐变 / `url()` 均可，平铺在页面元素上） | 无（不设则不输出） |
| `font-family-classical-song` | 宋体族（`FACSIMILE_FONT_TOKENS.SONG`） | 模板给出 |
| `font-family-classical-fangsong` | 仿宋族（`FACSIMILE_FONT_TOKENS.FANGSONG`） | 模板给出 |

颜色 / 线宽 / 纸纹属纯绘制令牌，**不进度量签名**；`facsimile.gutter.size` 与两个字体族令牌进签名。
`page-texture` 只在仿真装饰段输出（`pageDecoration && facsimile && 直排`），因此「古籍直排 / 现代横排」即便令牌里留了值也不会画出纸纹。

## 5. 三端渲染

| 路径 | `pageDecoration` | 版心注入 | 说明 |
| --- | --- | --- | --- |
| 阅读 `BtBookView` | `layout.facsimile !== undefined` | `reader.getPageGutterTexts()` + `serializePageGutter` | 翻页与滚动两种模式都注入 |
| 编辑分页 `PagedCanvas` | 同上 | 同源序列化，页级缓存 | 装饰为绝对定位伪元素，不影响点击定位 |
| 打印 `renderPrintHtml` | 仅 `mode === 'paged'` 且带 `facsimile` | 同源序列化 | `auto` 交给打印引擎重排，不加装饰 |
| EPUB | 不传 | 不注入 | reflow 无固定分页 |
| 连续编辑 `BtEditor` / 量尺 | 不传 | — | 避免装饰干扰点选与测量 |

样式表闸门为三重与：`pageDecoration === true` **且** `facsimile !== undefined` **且** 直排。

### 界行对齐（行款网格）

界行是**静态定距网格**（`repeating-linear-gradient`，从版心右缘起每「字号 × 行距」一条线）。
文字列要落在界行之间，必须保证**每个行盒的块轴厚度与所有块轴间距都是列距的整数倍**——
基础样式天然破坏该不变量（倍数行高按后代字号重算、双行小注的多栏块宽、引文 / 眉批的
块轴外距），任何一处破坏都会让后续所有列相对界行**永久错相**（文字骑线）。

`buildBookCss` 在三重闸门下输出「行款网格对齐层」（`facsimile-grid-css.ts`，
置于用户功能样式之前，可被覆盖）：

- **根行高绝对化**：根容器 `line-height` 从令牌倍数改为列距 px（`resolveLinePitch`），
  未显式设行高的后代（段落、注文小字、注码、题跋）行盒恒等于列距；
  `buildRootStyle`（预览页框 inline / 编辑画布 / 量尺工作表）同值；
- **显式行高归格**：标题 / 代码块 / 页底注区归一到列距；字号超过列距的
  （标题分级、封面 / 书名页大字）在构建期按「字号 ÷ 列距」向上取整 k 落 k 格；
- **双行小注一格双行（不用 CSS 多栏）**：Chromium 的直排多栏不可依赖——
  balancing 会把子列拦腰分段、溢出栏落位错乱（读序不通），`column-fill: auto`
  又被忽略导致列高塌缩半高。网格层改为**子列行高 = 列距一半的自然换列**：
  换行引擎天然保证读序（右子列从上读到底，余文续左子列）与子列满高
  （整条版心高），两个子列恰占一格；`min-width: 列距` 兜底单子列短注占满
  一格。超过两子列容量的长注多列续排，**奇数子列会偏半格**（CSS 无法强制
  子列成对，属已知限制；按格切分长注需 reader 结构级支持，列为后续工作）；
- **块轴装饰归零**：引文 / 眉批 / 牌记 / 题跋 / 版框节 / 注区的左右
  margin / padding / border 置 0（行内轴即上下方向的间距与配色保留），
  分隔线右缘线宽归零，表格单元格块轴内距归零。

批 2 起正文以**行内流连排**（`serializeVerticalFlow`，见 [05](05-layout-and-html.md)「直排行内流」）：容器列宽由根行高（= 列距）决定，与界行网格天然咬合；夹注为 1 字位宽整列高固定双列盒。网格层生效后所有文本块的横向占位恒为列距整数倍，块累计推进量永不落入
版心余数区（各模板 `textWidth ÷ 列距` 均有余数），末列裁字与
骑线自然消失；量尺实测随 CSS 同步，分页容量口径不变。

## 5.5 版面骨架扩展（v2 批 5）

仿真装饰层新增四件（全部纯装饰，不参与分页与度量）：

- **书耳（耳题）**：`facsimile.ear: true` 开启——版框外上角的小方框竖排
  题本页篇名（`reader.getPageEarText`：章名 → 卷名 → 书名回退；位置随版心
  所在侧镜像）。三端渲染 `serializePageEar(text, facsimile)`；
- **鱼尾扩展**：数量枚举至三 / 四尾（`GUTTER_FISH_TAILS`），多尾沿版心带
  均布且上下**相向**交替（偶数序尾垂直镜像）；新增 `fishTailStyle`
  （black 实心 / white 外框镂空 / line 细线勾形 / floral 花形剪裁），
  序列化输出 `data-fish-style` 供 CSS 分型；
- **眉栏**：`facsimile.eyebrow: true` 开启——版框上方天头横线区（套印本
  评点区界线）；
- **眉批 / 旁批装饰位**：仿真直排下 `head-note` 收集到天头容器
  （`.bt-page-eyebrow-host`，多列小字横排于版框上方）、`margin-note`
  收集到界行外窄条（`.bt-page-side-host`，版心带对侧）——预览与打印
  paged 分流，编辑画布保持 flow 原位（工作台可编辑）。

花栏（竹节 / 博古 / 卍字栏）按计划列为低优先可选，顺延未实现（border-image
纹样方案，需美术资源）。两截本 / 三截本见下节。

### 两截本 / 三截本（两截楼）

结构节点声明 `bands: 2 | 3`（可选 `bandRatio`，缺省 2 截 0.4/0.6、3 截
0.25/0.35/0.4）+ 内容节点 `band: 'upper' | 'middle' | 'lower'` 归截：

- **分截分页**：paginator 按截位分组，各截以「页容量 × 截高占比」独立
  装箱，页按序交错合并（同页含各截内容；某截页数不足则该位仅他截）；
- **渲染**：页内容包 `.bt-bands` 分层容器（物理纵向堆叠各截、截间
  `.bt-band-rule` 横线、截高按 flex-grow 比例 2:3 / 5:7:8），各截内部
  独立行内流连排（互不跨截）；预览与打印 paged 同构；
- **已知限制**：与页底浮注（noteArea）并存未支持（bands 时忽略）；
  `bandRatio` 自定义占比的渲染端读取待后续；编辑画布（PagedCanvas）
  两截本暂按平铺处理。
## 6. 设置面板

设置 →「古籍仿真」：

- **版式模板**：十二个芯片，进入「古籍仿真直排」主题时默认套用第一个（宋刻浙本）；
- **细节可调**：版框形态 / 界行 / 版心开关 / 口子 / 鱼尾 / 带宽 / 版心字段；
- **行款回显**：每半页 N 行 × 每行 M 字（由当前字号行距边距实时推导）；
- **已修改态**：与模板基准深比较（版式字段 + 字号/行距/字距/页边距），显示「已修改，基于 X」，可一键「恢复模板默认」。

模板令牌由 `resolveFacsimilePreset(id).tokens` **派生**合并（`theme.tokens → preset.tokens → tokenPatch → night`），不写入令牌补丁——因此从仿真切回「古籍直排」不会残留纸色 / 字体 / 框色。Demo 侧把这段规则收在 `apps/demo/src/facsimile-theme.ts` 的纯函数里（`resolveActiveFacsimilePreset` / `resolveFacsimilePresetTokens` / `resolveActiveFontToken`），布局与字体同源派生，便于单测。

## 7. 版心字段与卷次自动化（K5）

- 每套模板在 `facsimile-presets.ts` 显式声明 `gutter.fields`（字段序列，
  取值 `bookTitle` / `volumeTitle` / `chapterTitle` / `pageNumber`），
  缺省回退 `DEFAULT_GUTTER_FIELDS`（书名 / 篇卷 / 叶次），非仿真路径零变化；
- 卷次由 `reader` 自动推导：取页首块的最近 `volume` 祖先标题
  （`resolveVolumeTitleForNode`），调用方也可显式传入 `volumeTitle`；
- 鱼尾按字段序列**分段定位**：可见字段被均分为「鱼尾数 + 1」段，鱼尾落在
  段间（双鱼尾不重叠），模板字段顺序变化时鱼尾仍处在版心的视觉中点 / 三分点；
- `PageGutterTexts.volumeTitle` 为可选字段，旧调用方省略时输出为空串。

## 8. 已知限制

1. **字体**：仓库不打包字体文件，模板只给系统字体栈，缺失回退 `Noto Serif CJK SC` / `serif`；
2. **版框双边**用 CSS `border-style: double` 绘制（≥3px 才出双线），三段等分，不严格等于「外 2px / 间距 3px / 内 1px」的令牌比例——令牌只决定总厚度；
3. **版心恒在左侧**（`side` 可改右，但同页不交替）：单页视图折口固定，分页因此与奇偶解耦；
4. **行款网格的残余漂移**：行款网格对齐层已把文本块统一到列距整数倍
   （见「界行对齐」一节）；仍不落格的有——子列数为奇数的超长双行小注
   （偏半格）、表格（单元格边框残差约 2px）、插图 / 大印章等非文本块，
   古籍仿真场景罕见，复杂混排可用功能样式自行覆写；
5. **直排 `columns > 1` 不适用**：页面级 CSS 多栏与「按格对齐的古籍列」
   口径不一致（多栏的分段 / 落位在直排下不可控，双行小注亦已改用自然
   换列，见上），仿真模板固定单栏。
