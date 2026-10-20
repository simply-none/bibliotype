# @bibliotype/textconvert

繁简 / 异体字转换：内置常用字表离线兜底，外部实现（OpenCC）可插拔。

## 安装

```bash
pnpm add @bibliotype/textconvert
```

## 快速上手

```ts
import {
  convertText,
  createTableConverter,
  TRADITIONAL_TO_SIMPLIFIED,
  createOpenCcConverter,
} from '@bibliotype/textconvert';

convertText('學而時習之');                       // '学而时习之'
convertText('皇后');                             // '皇后'（词组保护）

const converter = createTableConverter(TRADITIONAL_TO_SIMPLIFIED);
converter.convertWithHits('為學');               // { text: '为学', hits: [...] }

// 生产级全量转换：接入 OpenCC
const opencc = createOpenCcConverter(OpenCC.Converter({ from: 'hk', to: 'cn' }));
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| 内置表 | `TRADITIONAL_TO_SIMPLIFIED` / `TRADITIONAL_TO_SIMPLIFIED_ENTRIES` / `TRADITIONAL_TABLE_ID` |
| 转换 | `createTableConverter` / `convertText` / `createOpenCcConverter` |
| 反向 | `reverseTable` / `findAmbiguousTargets`、`AMBIGUOUS_SIMPLIFIED` |
| 统计 | `summarizeHits` |

## 约定

- 匹配优先级：词组（长度降序）→ 单字 → 原样；
- `to === from` 的词组是保护规则（如「皇后」阻止其中的「後」被改写）；
- 反向表跳过一对多 / 歧义简体字（宁可不转，不产生错字）；
- 外部转换器不提供逐字命中，`convertWithHits().hits` 恒为空数组。

## 相关

- 功能参考：[docs/27-text-conversion.md](../../docs/27-text-conversion.md)
- 仓库主页：[bibliotype](../../README.md)
