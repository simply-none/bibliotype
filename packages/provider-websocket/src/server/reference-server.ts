/**
 * 参考协同服务端（G2）
 *
 * 只做最小可用实现：按书目 id 分房间、持有房间 Y.Doc、转发增量更新。
 * - 新连接 `join` 后先收 `joined` + 全量 `sync`；
 * - 客户端 `update` 应用到房间文档后广播给同房间其他连接；
 * - 空房间保留文档，便于客户端断线重连后继续同步（参考实现不做持久化）。
 *
 * `ws` 是可选 peer：只有引入本入口的宿主才需要安装它。
 * 生产环境请按自己的鉴权 / 房间模型替换，不要直接暴露到公网。
 */
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import {
  COLLAB_MAX_FRAME_BYTES,
  COLLAB_PROTOCOL_ERRORS,
  COLLAB_PROTOCOL_VERSION,
  decodeUpdate,
  encodeClientFrame,
  encodeServerFrame,
  encodeUpdate,
  parseClientFrame,
} from '../protocol.js';
import { normalizeSocketText } from '../socket.js';

/** 参考服务端选项 */
export interface ReferenceServerOptions {
  /** 监听端口（缺省 0：由系统分配，测试用） */
  port?: number;
  /** 监听地址（缺省全部网卡） */
  host?: string;
  /** 单帧字节上限（缺省 8 MiB） */
  maxPayloadBytes?: number;
}

/** 参考服务端句柄 */
export interface ReferenceServerHandle {
  /** 实际监听端口 */
  readonly port: number;
  /** 可直接用于 Provider 的地址（`ws://127.0.0.1:<port>`） */
  readonly url: string;
  /** 当前房间数（书目文档数） */
  readonly roomCount: number;
  /** 关闭服务端并断开全部连接 */
  close(): Promise<void>;
}

/** 房间（一本书的协同文档） */
interface Room {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly clients: Set<WebSocket>;
}

/** 连接级状态 */
interface ClientState {
  roomId?: string;
  clientId: string;
}

/** WebSocket 已打开状态（与 DOM 常量一致；不依赖 ws 实例属性） */
const WS_OPEN = 1;

/** 发送一帧（连接已关闭时静默跳过） */
function send(socket: WebSocket, frame: Parameters<typeof encodeServerFrame>[0]): void {
  if (socket.readyState !== WS_OPEN) return;
  try {
    socket.send(encodeServerFrame(frame));
  } catch {
    /* 单个连接的发送失败不影响房间内其他连接 */
  }
}

/** 向房间内除来源外的连接广播 */
function broadcast(room: Room, origin: WebSocket, update: Uint8Array): void {
  const frame = encodeServerFrame({ t: 'update', update: encodeUpdate(update) });
  for (const client of room.clients) {
    if (client === origin || client.readyState !== WS_OPEN) continue;
    try {
      client.send(frame);
    } catch {
      /* 忽略单连接发送失败 */
    }
  }
}

/**
 * 启动参考服务端
 *
 * @example
 * ```ts
 * const server = await startReferenceServer({ port: 8787 });
 * console.log(server.url);
 * await server.close();
 * ```
 */
export async function startReferenceServer(
  options: ReferenceServerOptions = {},
): Promise<ReferenceServerHandle> {
  const wss = new WebSocketServer({
    port: options.port ?? 0,
    host: options.host,
    maxPayload: options.maxPayloadBytes ?? COLLAB_MAX_FRAME_BYTES,
  });
  const rooms = new Map<string, Room>();

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => {
      resolve();
    });
    wss.once('error', (error) => {
      reject(error);
    });
  });

  const address = wss.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  wss.on('connection', (socket: WebSocket) => {
    /* 每个连接独立状态：房间与客户端标识 */
    const state: ClientState = { clientId: '' };

    const leaveRoom = (): void => {
      if (state.roomId === undefined) return;
      const room = rooms.get(state.roomId);
      state.roomId = undefined;
      if (room === undefined) return;
      room.clients.delete(socket);
    };

    socket.on('message', (data: unknown) => {
      const parsed = parseClientFrame(normalizeSocketText(data));
      if (!parsed.ok) {
        send(socket, { t: 'error', code: parsed.code, message: parsed.message });
        socket.close(1002, parsed.code);
        return;
      }
      const frame = parsed.frame;

      if (frame.t === 'ping') {
        send(socket, { t: 'pong', at: frame.at });
        return;
      }

      if (frame.t === 'join') {
        leaveRoom();
        state.clientId = frame.clientId;
        let room = rooms.get(frame.docId);
        if (room === undefined) {
          room = { id: frame.docId, doc: new Y.Doc(), clients: new Set<WebSocket>() };
          rooms.set(frame.docId, room);
        }
        room.clients.add(socket);
        state.roomId = frame.docId;
        send(socket, { t: 'joined', protocol: COLLAB_PROTOCOL_VERSION, clientId: frame.clientId });
        send(socket, { t: 'sync', update: encodeUpdate(Y.encodeStateAsUpdate(room.doc)) });
        return;
      }

      /* update：必须先 join */
      if (state.roomId === undefined) {
        send(socket, {
          t: 'error',
          code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
          message: '尚未 join 房间，不能发送 update。',
        });
        return;
      }
      const room = rooms.get(state.roomId);
      if (room === undefined) {
        send(socket, {
          t: 'error',
          code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
          message: `房间 ${state.roomId} 已不存在，请重新 join。`,
        });
        return;
      }
      let update: Uint8Array;
      try {
        update = decodeUpdate(frame.update);
        Y.applyUpdate(room.doc, update);
      } catch (error) {
        send(socket, {
          t: 'error',
          code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
          message: error instanceof Error ? error.message : '应用更新失败。',
        });
        return;
      }
      broadcast(room, socket, update);
    });

    socket.on('close', () => {
      leaveRoom();
    });
    socket.on('error', () => {
      /* 连接级错误由 close 收尾，避免未处理异常终止进程 */
    });
  });

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    get roomCount(): number {
      return rooms.size;
    },
    close(): Promise<void> {
      for (const client of wss.clients) {
        try {
          client.close(1001, 'server shutdown');
        } catch {
          /* 忽略关闭失败 */
        }
      }
      return new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

/** 供宿主构造 join 帧的便捷导出（避免直接依赖协议细节） */
export { encodeClientFrame };
