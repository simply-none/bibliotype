# @bibliotype/typography-cjk

中文排印规则：禁则避头尾、标点挤压、中西文混排间距。纯函数、零依赖。

## 安装

```bash
pnpm add @bibliotype/typography-cjk
```

## 快速上手

```ts
import {
  splitLines,
  buildCompressionAdjustments,
  needsCjkLatinGap,
  buildCjkTypographyCss,
} from '@bibliotype/typography-cjk';

splitLines('学而时习之，不亦说乎', 4);    // ['学而时习', '之，不亦', '说乎']
buildCompressionAdjustments('。」');       // [{ offset: 1, char: '」', squeezeEm: 0.5 }]
needsCjkLatinGap('文', 'a');               // true
buildCjkTypographyCss({ mixedSpacing: true });
// { 'line-break': 'strict', 'word-break': 'normal', 'overflow-wrap': 'break-word',
//   'text-autospace': 'normal' }
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| 字符分类 | `isCjkPunctuation` / `isCjkLetter` / `isLatinLetter` / `isDigit` / `isLatinLike` / `isWhitespace` / `isHighSurrogate` / `isLowSurrogate` |
| 禁则 | `KINSOKU_PROFILES` / `DEFAULT_KINSOKU_PROFILE` / `resolveKinsokuProfile`、`isForbiddenAtLineStart` / `isForbiddenAtLineEnd`、`findBreakOpportunities` / `resolveLineBreak` / `splitLines` |
| 挤压 | `findPunctuationRuns` / `buildCompressionAdjustments` / `totalSqueezeEm`、`DEFAULT_SQUEEZE_CHARS` |
| 混排 | `classifyChar` / `needsCjkLatinGap` / `buildMixedSpacingSegments` / `countMixedGaps`、`DEFAULT_MIXED_GAP_EM` |
| CSS | `buildCjkTypographyCss` / `cjkTypographyDeclarations`、`LINE_BREAK_VALUES` |

## 约定

- 坐标轴是 JS 字符串下标（UTF-16 码元），只拦「代理对中间」这一种非法切分；
- 拉丁字母与数字默认整体不断（`breakLatinWords: false`）；
- `resolveLineBreak` 找不到合法断点时退回容量上限，绝不返回 0；
- 混排间距只给「分段描述」，不在文本里插真实空格（避免污染搜索 / 复制 / 协同）。

## 相关

- 功能参考：[docs/25-cjk-typography.md](../../docs/25-cjk-typography.md)
- 仓库主页：[bibliotype](../../README.md)
