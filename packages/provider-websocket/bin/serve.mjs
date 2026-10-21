#!/usr/bin/env node
/**
 * 参考协同服务端 CLI
 *
 * 用法：`bt-collab-server [port]`（或 `PORT=8787 bt-collab-server`）
 * 需要宿主已安装可选 peer `ws`；仅用于本地联调与自测，不要直接暴露到公网。
 */
import { startReferenceServer } from '../dist/server/reference-server.js';

const rawPort = process.argv[2] ?? process.env.PORT ?? '8787';
const port = Number.parseInt(rawPort, 10);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[bt-collab-server] 端口非法：${rawPort}`);
  process.exit(1);
}

const server = await startReferenceServer({ port });
console.log(`[bt-collab-server] listening on ${server.url}`);

/** 优雅退出：先断开连接再关监听 */
async function shutdown() {
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
