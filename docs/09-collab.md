# 09 协同编辑

> 涉及包：`@bibliotype/collab`　·　相关：[01 数据模型](01-document-model.md)、[10 存储适配器](10-storage-adapters.md)

`@bibliotype/collab` 基于 Yjs 提供协同能力：IR ⇄ Y.Doc 映射、会话门面、Provider 抽象。
传输实现（WebSocket / WebRTC / Hocuspocus 等）由使用方或适配包提供，
内置 `InMemoryProvider` 用于测试与单进程多端演示。

## CollabSession —— 会话门面

```ts
import { CollabSession, InMemoryNetwork, InMemoryProvider } from '@bibliotype/collab';

const network = new InMemoryNetwork();                  // 进程内总线
const sessionA = new CollabSession({                    // 甲端
  user: { name: '钱大昕', color: '#8c5a2b' },
  provider: new InMemoryProvider(network),
});
const sessionB = new CollabSession({ user: { name: '戴震' }, provider: new InMemoryProvider(network) });

sessionA.loadDocument(document);                        // 写入 Y.Doc（已连接则同步到乙端）
const synced = sessionB.snapshot();                     // 乙端导出快照（BookDocument）
```

| 成员 | 说明 |
| --- | --- |
| `ydoc` | 底层 `Y.Doc`（供高级用法直接访问，如挂接编辑器绑定） |
| `currentUser` / `updateUser(patch)` | 本地用户身份（`{ name, color }`） |
| `loadDocument(doc)` | 全量载入文档（写入 Y.Doc） |
| `snapshot()` | 导出当前文档快照（`BookDocument`） |
| `onDocumentChange(handler)` | 订阅文档变更（每次事务后回调最新快照；返回取消订阅函数） |
| `connect()` / `disconnect()` | 连接 / 断开协同网络（幂等，断开保留本地文档） |
| `destroy()` | 销毁会话（断开、清空订阅、销毁 ydoc；之后操作抛错） |

`CollabSessionOptions`：`user`（局部覆盖）、`provider`（缺省为本地离线文档）、
`autoConnect`（默认 `true`，构造即连接）。

## IR ⇄ Y.Doc 映射

```ts
import { writeDocument, readDocument, YDOC_KEYS, ORIGIN_DOCUMENT_MAPPER } from '@bibliotype/collab';
import * as Y from 'yjs';

const ydoc = new Y.Doc();
writeDocument(ydoc, document);          // IR → Y.Doc（整体写入事务）
const snapshot = readDocument(ydoc);    // Y.Doc → IR
```

映射结构（`YDOC_KEYS`）：

| 键 | Y 类型 | 内容 |
| --- | --- | --- |
| `metadata` | `Y.Map` | 书目元数据字段 |
| `bibliotype-meta` | `Y.Map` | 映射元信息（`schemaVersion`） |
| `root` | `Y.XmlFragment` | 正文树（`__id` / `__attrs` 保留属性承载节点 id 与 attrs） |

映射层的事务以 `ORIGIN_DOCUMENT_MAPPER` 为来源标识，便于观察者区分本地映射写入与远端更新。

## Provider 抽象

```ts
import { PROVIDER_STATUS, type CollabProvider, type ProviderStatus } from '@bibliotype/collab';
```

| 接口成员 | 说明 |
| --- | --- |
| `readonly name` | 提供者名称（如 `'websocket'` / `'in-memory'`） |
| `readonly status` | 连接状态：`disconnected` / `connecting` / `connected` |
| `bind(ydoc)` | 绑定文档（由 `CollabSession` 构造时调用，延迟绑定） |
| `connect()` / `disconnect()` | 建立 / 断开连接（幂等；未绑定文档 connect 抛错） |
| `onStatusChange(handler)` | 订阅状态变更（返回取消订阅函数） |
| `destroy()` | 销毁（断开并释放资源，不可再连接） |

自定义传输只需实现本接口（如 WebSocket 客户端）：

```ts
import type { CollabProvider } from '@bibliotype/collab';

class MySocketProvider implements CollabProvider {
  readonly name = 'my-socket';
  // status / bind / connect / disconnect / onStatusChange / destroy …
}
```

## 内置：内存网络与提供者

- `InMemoryNetwork`：进程内总线。成员加入时先接收既有成员状态（增量合并、幂等），
  更新广播给除来源外的全部成员；`size` 为在线成员数；
- `InMemoryProvider(network)`：将 Y.Doc 接入总线；远端来源的更新不再回播（避免环路）。

## 网络传输：WebSocket 与多标签（G2）

`@bibliotype/provider-websocket` 提供两个实现，均满足 `CollabProvider`：

```ts
import { createWebSocketProvider, createBroadcastProvider } from '@bibliotype/provider-websocket';

/* 服务端（多端协同） */
const provider = createWebSocketProvider({
  url: 'wss://example.com/collab',
  docId: 'lunyu',
  clientId: 'user-a',
  socketFactory: (url) => new WebSocket(url),   // 缺省取全局 WebSocket
});

/* 本地多标签（同源标签页互同步，无服务端） */
const local = createBroadcastProvider({ channelName: 'bt:lunyu', clientId: 'tab-1' });

const session = new CollabSession(ydoc, provider);   // 构造即 connect
```

### 帧结构（协议版本 1）

文本帧 = JSON 信封 + base64 的 Yjs 更新；单帧上限 8 MiB（`COLLAB_MAX_FRAME_BYTES`）。

| 方向 | 帧 | 载荷 |
| --- | --- | --- |
| 客户端 → 服务端 | `join` | `{ protocol, docId, clientId }` |
| 客户端 → 服务端 | `update` | `{ update }` |
| 客户端 → 服务端 | `ping` | `{ at }` |
| 服务端 → 客户端 | `joined` | `{ protocol, clientId }` |
| 服务端 → 客户端 | `sync` | `{ update }`（房间全量状态） |
| 服务端 → 客户端 | `update` | `{ update }` |
| 服务端 → 客户端 | `pong` | `{ at }` |
| 服务端 → 客户端 | `error` | `{ code, message }`，`code` 为 `PROTOCOL_MISMATCH` / `BAD_FRAME` |

`parseClientFrame` / `parseServerFrame` 做结构校验与版本判定；版本不匹配返回
`PROTOCOL_MISMATCH`，客户端**不重试**（重试也不会成功），坏帧则断开后按退避重连。

### 连接语义

1. 连接建立 → 发 `join` → 收 `joined` + `sync` → 合并房间状态 → 状态置 `connected`；
2. 之后本地更新直发、远端更新以 provider 自身为 Yjs origin 应用（不回播）；
3. 断线期间本地更新进离线队列（`Y.mergeUpdates` 合并为一条），重连同步完成后一次补发；
4. 队列超过 `maxQueueBytes`（缺省 1 MiB）改为补发 `encodeStateAsUpdate` 全量状态，
   靠 Yjs 幂等合并保证不重复；**不允许静默丢更新**；
5. 退避为指数 + 抖动（`nextReconnectDelay`，随机源可注入），连接成功后清零；
6. 手动 `disconnect()` 不自动重连；握手超时（缺省 10s）按连接失败处理。

诊断：`provider.diagnostics` 给出 `reconnectAttempts` / `lastError` / `serverClientId`。

### 本地多标签

- 连上后广播 `hello`，已在线标签定向回 `state`（全量），迟到加入者因此能拿到既有内容；
- 本地更新以 `update` 广播；按 `from` 过滤自身消息，远端更新同样不回播；
- 频道不可用时 `connect()` 抛错，不静默降级（换 `WebSocketProvider` 或注入 `channelFactory`）。

### 参考服务端

```bash
# 先构建（bin 入口指向 dist），再启动；端口缺省 8787
pnpm --filter @bibliotype/provider-websocket build
pnpm --filter @bibliotype/provider-websocket serve 8787
```

```ts
import { startReferenceServer } from '@bibliotype/provider-websocket/server';

const server = await startReferenceServer({ port: 0 });   // 0 = 系统分配，测试友好
console.log(server.url);                                   // ws://127.0.0.1:<port>
await server.close();
```

按 `docId` 分房间、持有房间 `Y.Doc`、加入即回全量 `sync`；空房间保留状态以便重连。
`ws` 是**可选 peer** + devDependency：客户端入口不依赖它，只有引入 `./server` 的宿主需要安装。

边界：Awareness 远端光标（G3）暂缓，协议只留扩展位；参考服务端不做鉴权 / 持久化，
生产请按自己的房间与权限模型替换。

## 用户身份（简化 Awareness）

```ts
import { createDefaultUser, resolveUser, DEFAULT_USER_COLORS } from '@bibliotype/collab';

createDefaultUser(1);            // { name: '校勘者2', color: '#3d6b4f' }（按序号取色）
resolveUser({ name: '戴震' });    // 合并局部覆盖
DEFAULT_USER_COLORS;             // 古籍雅色系 5 色
```

POC 边界：仅管理本地用户身份；完整的多端光标 / 选区 Awareness 协议按
`y-protocols/awareness` 在 Provider 层扩展（Provider 负责转发）。

## 相关

- 包参考：[`@bibliotype/collab`](../packages/collab/README.md)
- 稳定 id 与协同锚点：[01 数据模型](01-document-model.md)
- 本地持久化：[10 存储适配器](10-storage-adapters.md)
