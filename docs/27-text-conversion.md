# 27 繁简与异体字转换

> 涉及包：`@bibliotype/textconvert`（无内部依赖）
> 相关篇目：[01 数据模型](01-document-model.md) · [11 主题与令牌](11-theme-tokens.md)

古籍与港台版内容常需「一键繁简」。本包把转换拆成**数据（转换表）**与**算法（转换器）**：

- 内置表：约百个高频繁简字 + 少量词组，离线兜底，无外部依赖；
- 外部实现：`createOpenCcConverter(openccConvert)` 接入 OpenCC 做全量转换与词组消歧。

## 一、直接转换

```ts
import { convertText } from '@bibliotype/textconvert';

convertText('學而時習之，不亦說乎');   // '学而时习之，不亦说乎'
convertText('皇后');                   // '皇后'（词组保护，单字「後→后」不生效）
```

## 二、命中记录（做预览与差异对比）

```ts
import { createTableConverter, TRADITIONAL_TO_SIMPLIFIED, summarizeHits } from '@bibliotype/textconvert';

const converter = createTableConverter(TRADITIONAL_TO_SIMPLIFIED);
const { text, hits } = converter.convertWithHits('為學為');
// text: '为学为'
// hits: [{ offset: 0, from: '為學', to: '为学' }, { offset: 2, from: '為', to: '为' }]

summarizeHits(hits);   // { total: 2, byFrom: { '為學': 1, '為': 1 } }
```

匹配优先级：**词组（长度降序）→ 单字 → 原样保留**；`to === from` 的词组是保护规则，
既不改写自身，也阻止其中的字被单字规则改写。

## 三、接入 OpenCC

```ts
import { createOpenCcConverter } from '@bibliotype/textconvert';
import * as OpenCC from 'opencc-js';

const converter = createOpenCcConverter(
  OpenCC.Converter({ from: 'hk', to: 'cn' }),
  { id: 'opencc-hk-cn', name: 'OpenCC 繁→简' },
);
converter.convert('學而時習之');
```

外部实现不提供逐字命中，`convertWithHits().hits` 恒为空数组（文档已声明，UI 需按此降级）。

## 四、反向（简 → 繁）

```ts
import { reverseTable, findAmbiguousTargets } from '@bibliotype/textconvert';

findAmbiguousTargets(TRADITIONAL_TO_SIMPLIFIED);   // ['于', '余', '发', '台', '后', ...]
const simplifiedToTraditional = reverseTable(TRADITIONAL_TO_SIMPLIFIED);
```

- 一对多目标（`发` ← 發 / 髮）、义项歧义字（`后`、`里`、`干`、`台`…）在**单字层被跳过**：宁可不转，也不产生错字；
- 词组层（`后来` → `後來`）无歧义时仍会还原；
- 需要严格可逆的双向转换请用 OpenCC，而不是反向内置表。

## 五、自定义表

```ts
const table = {
  id: 'my-variants',
  name: '异体字归一',
  entries: [
    { from: '峯', to: '峰' },
    { from: '羣', to: '群' },
  ],
  phrases: [{ from: '羣經', to: '群经' }],
};
```

校验：表的 `id` 不能为空；同一字出现互相冲突的规则会抛 `RangeError`。

## 六、在编辑 / 阅读链路中的位置

- **编辑**：转换应作用在**文本节点**上（`node.text`），标记与 `attrs` 原样保留；
  建议提供「预览差异 → 确认 → 一次性事务」，而不是边打字边转；
- **阅读**：作为渲染前的一次纯函数映射，结果可按 `(tableId, 文本哈希)` 缓存；
- **导出**：在 `serializeNode` 之前转换，避免影响锚点偏移（转换前后字长可能变化，锚点需重算）。
