---
'@bibliotype/layout': patch
'@bibliotype/typography-cjk': patch
---

中文精排接线（排版工业级批次 5）

**背景**：`@bibliotype/typography-cjk` 此前是整包零消费的死代码——禁则 / 挤压 /
混排算法与 CSS 声明生成器从未进入渲染管线，README 宣传的「中文精排」实际无效。

- **CSS 层接线**：`buildBookCss` 现在恒输出 `line-break: strict`（禁则避头尾的
  浏览器侧兜底，横排 / 直排一致）与 `word-break: normal`；`overflow-wrap` 收编到
  根容器一处（原 `.bt-code-block` 的重复声明移除，属性可继承行为不变）。
  新增 `cjkTypography` 选项（`punctuationCompression` / `mixedSpacing` /
  `hangingPunctuation` 三开关，缺省全关）按需输出 `text-spacing-trim` /
  `text-autospace` / `hanging-punctuation`（CSS Text 4，不支持的引擎自动退化）。
- **依赖方向**：`layout` 新增依赖 `@bibliotype/typography-cjk`（workspace，单向无环；
  typography-cjk 保持零依赖）。
- **字符类修正**（typography-cjk）：`classifyChar` 改用 `codePointAt`——扩展 B–F 区
  汉字（古籍用字高频）曾被 `charCodeAt` 高代理卡死永不可达；补 General Punctuation
  的 `—…‥''""·` 归标点、`々〆` 归字母（叠字符号曾误归标点）、部首 / IDS 拼合描述符 /
  笔画 / 半角片假名归字母。
- **禁则集修正**：zh-Hans 行尾补竖排开启括号 ︵︹︻︽︿﹁﹃（`vertical-text.ts`
  的竖排转换恰会产出它们）、行首补 `｡｣､・`、移除日文残留 `ー`（ja 配置不受影响）；
  断点判定补 ZWJ emoji 序列与变体选择符不拆分（曾只防代理对，emoji 家族 /
  组合字符可被劈开）。
- **标点挤压修正**：`…` 移出挤压集（GB/T 15834：省略号 …… 占两字位，压缩第二个
  `…` 会把六点省略号压变形）。
- 文档同步：docs/25 新增「接线状态」小节；typography-cjk README、根 README 依赖图更新。
