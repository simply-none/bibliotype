import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/reference-server': 'src/server/reference-server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  /* ws 是可选 peer：参考服务端直接引入，客户端入口不依赖它 */
  external: ['@bibliotype/core', '@bibliotype/collab', 'yjs', 'ws'],
});
