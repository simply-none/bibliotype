# 桌面导出修复（续）——书档瘦身：data URI 去重令牌化 + 资源分步传输

## 根因（本轮）
书档（BookDocument）里**同一缺字图以完整 data URI 逐处重复**（import-epub 内联策略），整本书档即数百 MB；上轮已把 HTML 生成移到主进程，但「书档过 IPC」仍是整本带图——preload `toCloneable` 深拷贝 + structured clone 再次 `Array buffer allocation failed`。

## 方案：三步会话协议 + 图片令牌化
### 1. 库（`packages/exporter-pdf/src/image-dedup.ts` 新增，纯函数 + 测试）
- `dedupeInlineImages(document)` → `{ document, assets: { token, dataUri }[] }`：**写时复制**遍历，`attrs.src` 的 `data:image/…` 收敛为唯一令牌 `__bibliotype_asset_N__`（同图只留一份、令牌按首现顺序）；未触及子树复用原引用（不整树深拷贝、不改入参）。
- `rehydrateInlineImages(document, resolve)`：就地把令牌 src 还原为 URL（主进程用）。
- `src/index.ts` 导出二者。

### 2. jianli-app 主进程（`bibliotype.ts` 通道改三步会话）
- `bibliotype:export-begin` → `{ exportId }`（单会话槽，重开覆盖）。
- `bibliotype:export-asset { exportId, token, dataUri }`：**逐张接收、收即写临时资源文件**（`<temp>/<exportId>/<token>.<扩展名>`，按 mime 定扩展名）——主进程内存 O(1)。
- `bibliotype:export-run { exportId, document(瘦身), options, filename, dir? }`：`rehydrateInlineImages` 把令牌 src 还原为相对资源路径 → `renderPrintHtml`（HTML 仅数 MB）→ 临时 HTML + `loadFile` → `printToPDF` → 写 fileCachePath → 清理会话目录 → `{ success, path }`。
- 兼容：旧 `html` 形态与 document 单发形态保留。

### 3. demo 渲染端（`use-export.ts` 桌面分支）
`dedupeInlineImages(book)` → `export-begin` → **逐 asset 上传（abort 可中断）** → `export-run`。浏览器端不变。

### 4. 测试
- exporter-pdf：去重唯一性/首现顺序、写时复制不污染原档、含非 data URI 混排、rehydrate 还原。
- demo routing：断言 begin → asset×N → run 顺序、payload.document 为瘦身书档、abort 中断上传。

### 5. 文档
- note_npm `docs/08`：契约改三步会话。
- jianli 技能：`modules/bibliotype.md` / `ipc-channels.md` / `SKILL.md` 里程碑同步。

## 验证
- 双仓 build/test/typecheck 全量。
- 手动：《杜诗详注》导出——预期 IPC 峰值从数百 MB 降到 <20MB，主进程内存 O(1 页)；矢量产物文字可选中。

## 交付
- note_npm：`fix(exporter-pdf,demo): 桌面导出图片资源分步传输——data URI 去重令牌化，修书档过 IPC 撞分配上限`
- jianli-app：`fix(bibliotype): 导出通道改三步会话，资源逐张落盘`
- 技能回写清单同上。