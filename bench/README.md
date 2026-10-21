# bench（I5 性能基准）

node 环境纯函数基准，防性能回退（详细口径见 `docs/18-performance.md`）。

## 用法

```bash
pnpm build          # runner 消费各包 dist ESM
pnpm bench          # 跑基准并与 bench/baseline.json 对比（劣化 >15% 失败，输出 bench/report.md）
pnpm bench:update   # 跑基准并把结果写为新基线
```

## 基准项

| 项 | 目标链路 | 输入 |
| --- | --- | --- |
| `layout/paginate-1000p` | `paginate` 分页装箱（I5 阶段口径 `layout`） | 3000 块 × 3px，页容量 1000，每 10 块一双栏（≈1000 页） |
| `exporter-epub/epub-50ch` | `exportEpub` 打包全流程（`export`） | 50 章 × 50 段合成文档 |
| `layout/serialize-5000nodes` | `serializeNode` XHTML 序列化 | 5000 段大节点树 |

量尺（`measure`）依赖浏览器离屏测量，node 基准不可行——以「量尺产物的消费端」（分页装箱）与 demo 侧 `PERF_MEASURE` 数据覆盖（见 docs/18）。

## 约定

- 每项预热 1 轮弃样 + 采样 5 轮取中位数（`bench/lib.mjs` 的 `median`）；
- 判定只看劣化方向：相对基线劣化 >15% 失败（`REGRESSION_THRESHOLD`），性能提升永远通过；
- 基线带 node 版本与平台；环境不一致时警告不失败（时序跨机不可比）；
- 有意扩容/优化后用 `pnpm bench:update` 重写基线，并在 changeset 描述中说明；
- 对比与报表纯函数在 `bench/lib.mjs`（core 包有确定性单测）。
