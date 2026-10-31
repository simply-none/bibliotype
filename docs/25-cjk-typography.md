# 25 中文排印（禁则 / 挤压 / 混排间距）

> 涉及包：`@bibliotype/typography-cjk`（无内部依赖，纯函数）
> 相关篇目：[05 版式与 HTML](05-layout-and-html.md) · [04 阅读器与分页](04-reader-and-pagination.md) · [18 纸书排版引擎](18-pagination-engine-roadmap.md)

网页排版默认按「字符流」断行，纸书按「禁则」断行——这是书籍级排版与普通网页的分水岭。
本包把三条规则做成可测试的纯函数：

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 禁则避头尾 | `findBreakOpportunities` / `resolveLineBreak` / `splitLines` | 标点不居行首、前括号不居行尾 |
| 标点挤压 | `buildCompressionAdjustments` | 连续标点后续压半角 |
| 中西文混排 | `needsCjkLatinGap` / `buildMixedSpacingSegments` | 汉字与拉丁 / 数字间 1/4 em |
| CSS 声明 | `buildCjkTypographyCss` | 供 `buildBookCss` / 站点样式拼接 |

---

## 一、禁则

```ts
import {
  findBreakOpportunities,
  isForbiddenAtLineStart,
  resolveLineBreak,
  splitLines,
} from '@bibliotype/typography-cjk';

isForbiddenAtLineStart('。');      // true —— 句号不能出现在行首
findBreakOpportunities('「你好」');  // [2]：只能在「你」「好」之间断
splitLines('学而时习之，不亦说乎', 4); // ['学而时习', '之，不亦', '说乎']
```

规则：

- **行首禁则**（收束性标点）：`。，、；：？！）〕］｝〉》」』】…｡｣､・` 等；
- **行尾禁则**（开启性标点）：`（〔［｛〈《「『【…` 等横排形式，及竖排开启括号
  `︵︷︹︻︽︿﹁﹃` 等（U+FE35~FE47 的开启形式，直排夹注 / 括注用）；
- 拉丁单词与数字默认**整体不断**（`breakLatinWords: false`），`abc中文` 只在 `c` 与 `中` 之间断；
- 代理对（emoji / 扩展区汉字）不从中间截断；零宽连字 ZWJ（U+200D）两侧、
  变体选择符（U+FE0E/FE0F）与其基字同样不从中间断开；
- `perCharacter: false` 时退化为「只在空白后断行」（西文近似行为）；
- 日文长音「ー」（U+30FC）只属 `ja` 配置的禁则，中文（zh-Hans）不再拦截。

内置配置：`zh-Hans`（缺省）、`zh-Hant`（补 `﹑‧・`）、`ja`（补长音符、叠字符与小假名）。
自定义禁则：

```ts
findBreakOpportunities('甲乙丙', { extraForbiddenStart: '乙' });   // 不止在乙前断
findBreakOpportunities(text, { profile: 'ja' });
```

`resolveLineBreak(text, maxUnits, { from })` 是分页器要用的贪心断点：

- 从容量上限向前找第一个合法断点；
- 找不到（整行是不可断的长英文串）时**退回容量上限**，绝不返回 0 造成死循环；
- `splitLines` 的分行结果拼接后恒等于原文。

## 二、标点挤压

连续全角标点（`。」`、`，、`）视觉上会拉出空档。规则：**段内首字保持全角，其余各压 `squeezeEm`（缺省 0.5em）**。

```ts
buildCompressionAdjustments('。」');
// [{ offset: 1, char: '」', squeezeEm: 0.5 }]

totalSqueezeEm(buildCompressionAdjustments(text));   // 可省下的总宽度（em）
```

缺省挤压字符集（`DEFAULT_SQUEEZE_CHARS`）**不含省略号「…」（U+2026）**：GB/T 15834 规定
省略号「……」占两字位（两个 U+2026 连用），压缩第二个会把六点省略号压变形；
确有需要可用 `squeezeChars` 选项自行覆盖。

单标点不挤压；行首行尾的悬挂交给 CSS `hanging-punctuation`，不在文本层处理。

## 三、中西文混排

```ts
needsCjkLatinGap('文', 'a');   // true
needsCjkLatinGap('文', '，');  // false —— 标点与空白不插距

buildMixedSpacingSegments('中文abc中文');
// [{ text: '中文', gapBeforeEm: 0 }, { text: 'abc', gapBeforeEm: 0.25 }, { text: '中文', gapBeforeEm: 0.25 }]
```

字符分类（`classifyChar`）按**完整 Unicode 码位**（`codePointAt`）判定，扩展 B~F 区
汉字不会因代理对误判；部首区（U+2E80~2FDF）、表意文字描述符（U+2FF0~2FFF）、
笔画（U+31C0~31EF）、半角片假名（U+FF66~FF9F）与叠字符号 `々〆`（U+3005/3006）
均归入文字类，General Punctuation 的破折号 / 省略号 / 弯引号 / 间隔号归入标点。

**不在文本里插入真实空格**：那会污染正文（搜索、复制、协同、字数统计全部受影响）。
提 供分段描述后，渲染层用 `text-autospace` 或分段包裹实现留白。

## 四、CSS 声明

```ts
import { buildCjkTypographyCss, cjkTypographyDeclarations } from '@bibliotype/typography-cjk';

buildCjkTypographyCss({ punctuationCompression: true, mixedSpacing: true });
// { 'line-break': 'strict', 'word-break': 'normal', 'overflow-wrap': 'break-word',
//   'text-spacing-trim': 'space-first', 'text-autospace': 'normal' }

cjkTypographyDeclarations({ hangingPunctuation: true });
```

### 接线状态（中文精排批次）

CSS 声明层已由 `@bibliotype/layout` 的 `buildBookCss` 消费（包依赖 `layout → typography-cjk`，
单向、`typography-cjk` 仍零依赖）：

- **恒输出**（根容器规则，横排 / 直排一致）：`line-break: strict`（避头尾的浏览器侧
  兜底）、`word-break: normal`（防宿主样式 `break-all` 污染书册断行）、
  `overflow-wrap: break-word`（自 `.bt-code-block` 收编到根容器一处，该属性可继承，
  代码块行为不变）；
- **可选能力经 `BuildBookCssOptions.cjkTypography` 开关输出，缺省全关**（既有产物
  逐字符稳定，古典基线快照守护）：`punctuationCompression` → `text-spacing-trim: space-first`、
  `mixedSpacing` → `text-autospace: normal`、`hangingPunctuation` → `hanging-punctuation: first last`；
- 文本层算法（本文第一至三节的纯函数）仍按需由分页器与渲染层调用，作为旧引擎
  不支持上述 CSS 属性时的确定性兜底。

兼容性说明：`text-spacing-trim` / `text-autospace` 属 CSS Text 4，旧引擎忽略即退化为
「不挤压 / 不插距」，不会报错；确定性兜底是本文第二节与第三节的函数。

## 五、与分页器集成

分页器当前按 `lineSize` 折算行数与行级拆分（`packages/layout/src/paginator.ts`）。
把禁则接进去的方式：

1. 量尺阶段用 `splitLines(text, maxUnits)` 得到真实行数 → 写入 `MeasurableBlock.lineCount`；
2. 行级拆分时用同样的断点切分，保证「预览 / 编辑 / 导出」三处断行一致；
3. 直排时把 `maxUnits` 换成每列容纳字数，禁则判定不变（列首 = 行首）。

## 六、常见错误

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 句号跑到行首 | 按字数硬切 | 用 `resolveLineBreak` 取合法断点 |
| 英文单词被拆开 | 逐字断行未排除拉丁串 | 保持 `breakLatinWords: false` |
| 文字复制后多出空格 | 为了混排间距插了真实空格 | 用分段 + CSS 留白 |
| 挤压后行宽算不准 | 只在 DOM 层挤压，布局账本未计入 | 挤压量需回写行宽账本（`totalSqueezeEm`） |
