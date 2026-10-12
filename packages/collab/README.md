# @bibliotype/collab

协同校勘：IR ⇄ Y.Doc 映射、协同会话（`CollabSession`）与 Provider 抽象。
自带内存网络实现（`InMemoryNetwork` / `InMemoryProvider`），用于单元测试与单进程多端演示；
生产环境实现 `CollabProvider` 接口对接真实网络（如 WebSocket）。

## 安装

```bash
pnpm add @bibliotype/collab @bibliotype/core yjs
```

## 快速上手

```ts
import { CollabSession, InMemoryNetwork, InMemoryProvider } from '@bibliotype/collab';

/* 内存网络：同进程多端互联（两个会话即可模拟双人协同） */
const network = new InMemoryNetwork();
const sessionA = new CollabSession({
  user: { name: '钱大昕' },
  provider: new InMemoryProvider(network),
});
const sessionB = new CollabSession({
  user: { name: '戴震' },
  provider: new InMemoryProvider(network),
});

sessionA.loadDocument(document);   // 写入 Y.Doc（在线时同步给 B）

const off = sessionB.onDocumentChange((doc) => {
  console.log('B 收到最新快照：', doc.metadata.title);
});

const snapshot = sessionB.snapshot();   // 导出当前 IR（可交给 Reader / 编辑器）

/* 生命周期 */
sessionA.disconnect();                  // 断开网络（保留本地文档）
sessionA.connect();                     // 重新连接（幂等）
sessionA.updateUser({ name: '竹汀' });  // 更新本地用户
off();
sessionA.destroy();                     // 断开 + 清空订阅 + 销毁 Y.Doc
sessionB.destroy();
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| IR ⇄ Y.Doc 映射 | `YDOC_KEYS`、`ORIGIN_DOCUMENT_MAPPER`、`writeDocument(ydoc, doc)`、`readDocument(ydoc)` |
| Provider | `CollabProvider`（`name` / `status` / `bind` / `connect` / `disconnect` / `onStatusChange` / `destroy`）、`PROVIDER_STATUS`、`InMemoryNetwork`、`InMemoryProvider(network)` |
| 会话 | `CollabSession`（`loadDocument` / `snapshot` / `onDocumentChange` / `connect` / `disconnect` / `updateUser` / `destroy` / `currentUser`） |
| 用户 | `CollabUser { name, color }`、`DEFAULT_USER_COLORS`、`createDefaultUser()`、`resolveUser(partial)` |

`CollabSessionOptions`：`user?`（缺省生成默认身份）、`provider?`（缺省为本地离线文档）、
`autoConnect?`（默认 `true`）。

## 设计要点

- **延迟绑定**：Provider 先创建、后由 `CollabSession` 注入 Y.Doc，会话是文档的唯一所有者；
- **环回抑制**：远端来源的更新不再回播，避免广播环路；
- **统一订阅**：本地与远端变更经同一 `ydoc.on('update')` 通道回调最新快照；
- 更新以增量事务写入（`ORIGIN_DOCUMENT_MAPPER` 标记来源），为协同编辑器绑定预留。

## 相关

- 功能参考：[docs/09-collab.md](../../docs/09-collab.md)
- 数据模型：[docs/01-document-model.md](../../docs/01-document-model.md)
- 仓库主页：[bibliotype](../../README.md)
