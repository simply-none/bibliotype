# @bibliotype/core

bibliotype 的地基：IR 数据模型（节点 / 标记 / 元数据 / 文档）、类型化事件总线、
节点类型与插件注册、主题令牌、存储契约（Port）。

纯数据与纯函数、无框架与 DOM 依赖，浏览器与 Node 同构。

## 安装

```bash
pnpm add @bibliotype/core
```

## 快速上手

### 构建文档（IR）

```ts
import { createEmptyDocument, NODE_TYPES } from '@bibliotype/core';

const document = createEmptyDocument({ title: '论语集解' });   // → BookDocument

document.root.children?.push({
  type: NODE_TYPES.CHAPTER,
  id: 'ch-1',
  children: [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: NODE_TYPES.TEXT, text: '子曰：学而时习之，不亦说乎？' }],
    },
  ],
});
```

节点结构为 `BookNode { type, id?, attrs?, children?, text?, marks? }`：
文本叶子以 `text` 字段标识（`isTextNode` 判定），行内标记挂在 `marks` 上；
结构节点与需被引用的节点建议始终携带稳定 `id`（协同 / 批注 / 交叉引用依赖）。

### 核心实例与插件

```ts
import { createBibliotype, definePlugin } from '@bibliotype/core';

const instance = createBibliotype();   // 预置 core 节点定义与默认主题

instance.plugins.install(
  definePlugin({
    name: '@example/example-plugin',
    install(context) {
      const off = context.events.on('document:load', ({ document }) => {
        console.log('文档已载入：', document.metadata.title);
      });
      return () => off();   // 清理函数：uninstall / dispose 时调用
    },
  }),
);

instance.dispose();   // 卸载全部插件并清空订阅
```

### 主题与事件

```ts
import { createBibliotype, FONT_SIZE_TOKENS } from '@bibliotype/core';

const instance = createBibliotype({ theme: { [FONT_SIZE_TOKENS.BODY]: '18px' } });

instance.theme.get(FONT_SIZE_TOKENS.BODY);   // '18px'
instance.theme.all();                        // 全部令牌（供 layout 生成 CSS）

instance.events.on('page:change', ({ pageIndex, totalPages }) => {
  console.log(`第 ${pageIndex + 1} / ${totalPages} 页`);
});
```

### 事件一览

| 事件 | 载荷 | 触发时机 |
| --- | --- | --- |
| `document:load` | `{ document }` | 文档加载完成 |
| `document:save` | `{ documentId }` | 存储适配器写入完成 |
| `document:meta-change` | `{ changedKeys }` | 元数据变更 |
| `page:change` | `{ pageIndex, totalPages }` | 翻页 / 重新分页 |
| `render:complete` | `{ durationMs }` | 渲染完成 |
| `toc:ready` | `{ itemCount }` | 目录生成完成 |
| `collab:remote-update` | `{ update: Uint8Array }` | 协同远端更新 |
| `plugin:installed` | `{ name, version? }` | 插件安装完成 |

事件名采用 `领域:动作` 约定；插件可通过声明合并扩展 `BibliotypeEventMap` 获得类型推导。

## API 概览

| 分组 | 导出 |
| --- | --- |
| IR 数据模型 | `NODE_TYPES` / `MARK_TYPES`、`BookNode` / `BookMark`、`isTextNode` / `readAttr`、`BookMetadata` 及 `Contributor` / `EditionInfo` / `Identifier` / `PublicationInfo`、`BookDocument` / `createEmptyDocument` / `isBookDocument` / `IR_SCHEMA_VERSION` |
| 事件总线 | `EventBus` / `createEventBus`、`BibliotypeEventMap`、`EventHandler` / `Unsubscribe` |
| 节点注册 | `NodeTypeRegistry` / `NodeTypeConflictError`、`CORE_NODE_DEFINITIONS`、`NAMESPACES`、`NodeKind` / `NodeTypeDefinition` |
| 插件系统 | `BibliotypePlugin` / `definePlugin`、`PluginRegistry` / `PluginConflictError`、`BibliotypeContext` / `ThemeAccessor` |
| 主题令牌 | `FONT_TOKENS` / `FONT_SIZE_TOKENS` / `LAYOUT_TOKENS` / `COLOR_TOKENS`、`DEFAULT_THEME`、`createThemeAccessor` |
| 核心实例 | `createBibliotype`（`BibliotypeInstance` / `CoreInstanceOptions`） |
| 存储契约 | `StorageAdapter`、`StoredDocument`、`DocumentSummary`、`SaveOptions` |
| 书架与备份 | `BookLibraryStore` / `isBookLibraryStore` / `DocumentQuery` / `queryDocumentSummaries`、`BookSummaryStore` / `isBookSummaryStore`、`buildDocumentSummary` / `mergeDocumentSummary`、`packBookArchive` / `unpackBookArchive` / `BookPackCodec`、`buildLibraryBackupFiles` / `restoreLibrary` / `BACKUP_CONFLICT_STRATEGIES` |
| 历史版本 | `createSnapshot` / `restoreSnapshot` / `nextSnapshotVersion`、`DocumentVersionStore` / `isDocumentVersionStore`、`selectExpiredSnapshots` / `assertRetentionPolicy`、`diffDocuments` / `inlineTextDiff` |
| 修订 | `REVISION_MARK_TYPES` / `REVISION_VIEWS`、`collectRevisions` / `resolveMarksForView`、`acceptRevisions` / `rejectRevisions` / `projectRevisionView` |
| 加密与脱敏 | `deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、`createEncryptedStorageAdapter` / `createEncryptedAssetStore`、`CryptoError` / `CRYPTO_ERROR_CODES`、`redactDocument` / `redactAnnotations` |
| 资产契约 | `AssetStore` / `AssetPayload` / `AssetRef` / `AssetKind`、`ASSET_KINDS`、`toAssetRef` / `hashAssetBytes` / `isAssetStore` |
| 分片内核 | `CHUNK_BUDGET_BYTES`、`buildChunkedSnapshot` / `fromSkeleton`、`ChunkSlice` / `SkeletonNode` / `ChunkNodeMap`（IndexedDB / SQLite 共用） |
| 锚点 | `Anchor` / `BlockAnchor` / `TextAnchor`、`ANCHOR_TYPES`、`createBlockAnchor` / `createTextAnchor`、`serializeAnchor` / `parseAnchor`、`resolveAnchor` / `clampAnchor`、`locateNode` / `nodePlainText` |
| 校验与迁移 | `validateDocument` / `DOCUMENT_ISSUE_CODES`、`DocumentIssue` / `ValidationResult`、`migrateDocument` / `MigrationStep` / `MigrationPathError`、`readSchemaVersion` / `LEGACY_SCHEMA_VERSION` / `BUILTIN_MIGRATIONS` |

## 锚点（跨能力的位置契约）

```ts
import { createTextAnchor, resolveAnchor, serializeAnchor } from '@bibliotype/core';

const anchor = createTextAnchor('p-1', 3, 4);
serializeAnchor(anchor);                    // 'bt:text:p-1:3:4'
resolveAnchor(document.root, anchor);       // { node, text: '习之，不', clamped: false }
```

页码会随版式漂移，节点 id 不会。阅读位置、批注、脚注 ref、交叉引用、协同光标都基于该契约。

## 校验与迁移

```ts
import { validateDocument, migrateDocument } from '@bibliotype/core';

validateDocument(document, { knownNodeTypes: ['double-note'] }).errors;
migrateDocument(raw, { steps: [{ from: '0.0.0', to: '0.1.0', migrate: (doc) => doc }] });
```

- `validateDocument`：节点类型 / 标记 / 形态 / 属性 / id 唯一性，问题带 `path` 与 `nodeId`；
- `migrateDocument`：逐级迁移，缺环抛 `MigrationPathError`，迁移后自动校验。

## 书架、备份、修订、历史与加密

五块能力都是「纯函数内核 + 可选端口」，核心包不引压缩库、不碰 DOM：

```ts
import {
  buildDocumentSummary, mergeDocumentSummary, queryDocumentSummaries,
  packBookArchive, restoreLibrary, BACKUP_CONFLICT_STRATEGIES,
  collectRevisions, acceptRevisions, projectRevisionView,
  createSnapshot, restoreSnapshot, diffDocuments,
  deriveKeyPbkdf2, createStringCipher, createEncryptedStorageAdapter,
  redactDocument,
} from '@bibliotype/core';

/* 摘要：字数由保存侧算好传入；旧记录缺字段走 merge 回退 */
const summary = buildDocumentSummary({ id, metadata, updatedAt, wordCount });
mergeDocumentSummary(summary, { progress: 0.32, lastOpenedAt: now });

/* 查询：检索词全部命中，标签命中任一，支持排序与分组 */
queryDocumentSummaries(summaries, { text: '朱熹', sortBy: 'recentRead', groupBy: 'tag' });

/* 修订：接受 / 拒绝 / 投影到终稿 */
acceptRevisions(document, ['change-1']);
projectRevisionView(document, 'final');

/* 历史：快照带校验和，回滚前双重校验 */
const snap = createSnapshot({ documentId: 'lunyu', document, version: 1, createdAt: now });
const restored = restoreSnapshot(snap);   // { ok: false, code, issues, message } 时拒绝落库

/* 加密：装饰既有适配器，底层只看到密文 */
const cipher = createStringCipher(await deriveKeyPbkdf2({ password, salt }));
const secure = createEncryptedStorageAdapter({ inner: storage, cipher });
```

- `.btbook` 与整库备份共用同一 `BookPackCodec` 端口，ZIP 由宿主注入；
- 修订的 `insertion` / `deletion` / `format-change` 三种标记在 core 统一登记，接受 / 拒绝语义只有一份；
- 快照与修订时间、加密随机源全部参数注入，产物可确定性复现。

## 测试子入口

`@bibliotype/core/testing` 提供存储适配器的公共契约套件（仅 ESM，依赖 `vitest`，不进主入口）：

```ts
import { runStorageContractTests, sampleDocument } from '@bibliotype/core/testing';

runStorageContractTests({ name: 'MyAdapter', create: () => new MyAdapter() });
```

## 相关

- 功能参考：[docs/01-document-model.md](../../docs/01-document-model.md)
- 校验 / 迁移 / 锚点：[docs/23-ir-validation-and-migration.md](../../docs/23-ir-validation-and-migration.md)
- 主题与令牌：[docs/11-theme-tokens.md](../../docs/11-theme-tokens.md)
- 存储适配器：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 仓库主页：[bibliotype](../../README.md)
