/**
 * Demo 站点 Vite 配置
 *
 * 应用构建（非库模式）：Vue 插件 + 默认产物目录 dist。
 *
 * `base` 由 `VITE_BASE_PATH` 决定（默认 `/`）：部署到 GitHub Pages 的
 * 项目页（`https://<owner>.github.io/<repo>/`）时需传 `/` + 仓库名，
 * 否则产物中的绝对路径资源会 404；自定义域名 / 用户页仍为 `/`。
 * 构建产物的 base 变化必须让 turbo 缓存失效，故该变量同时登记在 turbo.json。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // 第三参数传空串：不限定前缀，进程环境变量（CI 注入）与 .env 一并读取
  const env = loadEnv(mode, '.', '');

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [vue()],
    // 工作区内部包（@bibliotype/*）以软链 + dist 形式被 demo 引用，若被 Vite 预构建（optimizeDeps）
    // 则会缓存旧 dist，重新 build 包后 dev server 不失效 → 需硬排除，让它直接消费 dist 并随重建热更新。
    optimizeDeps: {
      exclude: ['@bibliotype/core', '@bibliotype/layout', '@bibliotype/reader', '@bibliotype/editor', '@bibliotype/vue', '@bibliotype/collab', '@bibliotype/classical', '@bibliotype/import', '@bibliotype/import-docx', '@bibliotype/import-epub', '@bibliotype/exporter-epub', '@bibliotype/exporter-pdf', '@bibliotype/adapter-indexeddb'],
    },
  };
});
