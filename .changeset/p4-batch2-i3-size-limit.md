---
'@bibliotype/core': patch
---

P4 批 2（I3）：体积预算门禁。根引入 `size-limit`（v11，兼容 Node 20）+ `@size-limit/preset-small-lib`，`.size-limit.json` 登记四个核心包 gzip 阈值（core 32 KB 最严档，layout 13 KB / editor 54 KB / vue 165 KB 次档，按交付基线上浮约 7–11%）；根脚本 `pnpm size`，CI 在 build 后执行门禁，超限失败并指出包名与超出量；阈值口径与扩容约定回写 docs/12。
