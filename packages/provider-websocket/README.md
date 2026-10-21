# @bibliotype/provider-websocket

协同网络传输：WebSocket Provider（自动重连 + 离线队列）、BroadcastChannel 多标签 Provider，
以及可运行的参考 Node 服务端。协议只搬运 Yjs 更新，不关心 IR 结构。

## 安装

```bash
# 客户端：包本身不依赖任何 WebSocket 实现（浏览器用原生）
pnpm add @bibliotype/provider-websocket @bibliotype/collab yjs

# 参考服务端（可选）：宿主自行安装 ws
pnpm add ws
```

Node 下作为客户端使用时，注入 `ws` 的 `WebSocket` 即可（见下）。

## 快速上手

```ts
import { CollabSession } from '@bibliotype/collab';
import { createWebSocketProvider, createBroadcastProvider } from '@bibliotype/provider-websocket';

/* 多端协同 */
const provider = createWebSocketProvider({
  url: 'wss://example.com/collab',
  docId: 'lunyu',
  socketFactory: (url) => new WebSocket(url),   // Node：注入 ws 的 WebSocket（见测试）
});
const session = new CollabSession(ydoc, provider);   // 构造即 connect

/* 本地多标签（同源） */
const local = createBroadcastProvider({ channelName: 'bt:lunyu' });
```

```ts
provider.onStatusChange((status) => {
  /* 'disconnected' | 'connecting' | 'connected' */
});
provider.diagnostics;   // { reconnectAttempts, lastError, serverClientId }
provider.ping();        // 心跳（仅 connected 时成功）
```

## API 概览

| 分组 | 导出 |
| --- | --- |
| Provider | `WebSocketProvider` / `createWebSocketProvider`、`BroadcastProvider` / `createBroadcastProvider` |
| 协议 | `COLLAB_PROTOCOL_VERSION`、`COLLAB_MAX_FRAME_BYTES`、`COLLAB_PROTOCOL_ERRORS`、`encodeClientFrame` / `parseClientFrame`、`encodeServerFrame` / `parseServerFrame`、`encodeUpdate` / `decodeUpdate` |
| 重连 | `nextReconnectDelay(attempt, { baseDelayMs, maxDelayMs, factor, jitterRatio, random })` |
| 离线队列 | `OfflineUpdateQueue({ maxQueueBytes })`：`push` / `drain` / `clear` / `needsFullSync` |
| 传输适配 | `WebSocketLike`、`SocketFactory`、`attachSocketHandlers`、`normalizeSocketText`、`defaultSocketFactory` |
| 服务端 | `@bibliotype/provider-websocket/server`：`startReferenceServer({ port, host, maxPayloadBytes })` |

`WebSocketProviderOptions`：`url`、`docId`、`clientId?`、`socketFactory?`、`autoReconnect?`（缺省 true）、
`backoff?`、`maxQueueBytes?`（缺省 1 MiB）、`maxReconnectAttempts?`、`handshakeTimeoutMs?`（缺省 10s）、
`now?` / `random?`（测试注入）。

## 协议（版本 1）

文本帧 = JSON，`update` 为 base64 的 Yjs 更新；单帧上限 8 MiB。

| 方向 | 帧 | 载荷 |
| --- | --- | --- |
| C → S | `join` | `{ protocol, docId, clientId }` |
| C → S | `update` | `{ update }` |
| C → S | `ping` | `{ at }` |
| S → C | `joined` | `{ protocol, clientId }` |
| S → C | `sync` | `{ update }` |
| S → C | `update` | `{ update }` |
| S → C | `pong` | `{ at }` |
| S → C | `error` | `{ code: 'PROTOCOL_MISMATCH' \| 'BAD_FRAME', message }` |

版本不匹配 → 记录错误、断开、**不重连**；坏帧 → 断开后按退避重试。

## 连接与离线语义

1. `connect()` → `join` → 收 `joined` + `sync` → 合并房间状态 → `connected`；
2. 之后本地更新直发；远端更新以 provider 自身为 origin 应用，不回播；
3. 断线期间的更新进队列并 `Y.mergeUpdates` 合并，重连同步完成后一次补发；
4. 队列超限改发 `encodeStateAsUpdate` 全量状态，靠 Yjs 幂等合并保证不重复；
5. 指数退避 + 抖动，连接成功清零；手动 `disconnect()` 永不自动重连；
6. 握手超时按连接失败处理；`destroy()` 后 `connect()` 抛错。

`BroadcastChannel` 侧没有“断线重连”：连上即 `hello` 索取既有状态，迟到加入者由在线标签
定向回 `state` 全量；非法消息记录 `lastError` 但不断开本地总线。

## 参考服务端

```bash
pnpm --filter @bibliotype/provider-websocket build
pnpm --filter @bibliotype/provider-websocket serve 8787
```

```ts
import { startReferenceServer } from '@bibliotype/provider-websocket/server';

const server = await startReferenceServer({ port: 0 });
// server.url → ws://127.0.0.1:<port>；server.roomCount
await server.close();
```

按 `docId` 分房间、持有 `Y.Doc`、加入即回全量 `sync`；空房间保留状态以便重连。
`ws` 只是可选 peer + devDependency：客户端入口不引用它。

## 设计要点与边界

- 协议层与传输层分离：帧解析、退避、队列都是纯函数 / 小类，可单测；
- socket 只依赖鸭子类型，浏览器原生 / `ws` / 测试假实现共用一套事件归一化；
- `join` 幂等，重复调用只会重新挂载房间；
- 不做 Awareness 远端光标（G3 暂缓），协议只留扩展位；
- 参考服务端无鉴权、无持久化、无房间淘汰，**不要直接暴露到公网**。

## 相关

- 功能参考：[docs/09-collab.md](../../docs/09-collab.md)
- 协同端口与会话：[`@bibliotype/collab`](../collab/README.md)
- 仓库主页：[bibliotype](../../README.md)
