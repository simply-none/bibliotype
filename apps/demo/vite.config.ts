/**
 * Demo 站点 Vite 配置
 *
 * 应用构建（非库模式）：Vue 插件 + 默认产物目录 dist。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // 工作区内部包（@bibliotype/*）以软链 + dist 形式被 demo 引用，若被 Vite 预构建（optimizeDeps）
  // 则会缓存旧 dist，重新 build 包后 dev server 不失效 → 需硬排除，让它直接消费 dist 并随重建热更新。
  optimizeDeps: {
    exclude: ['@bibliotype/core', '@bibliotype/layout', '@bibliotype/reader', '@bibliotype/editor', '@bibliotype/vue', '@bibliotype/collab', '@bibliotype/classical', '@bibliotype/import', '@bibliotype/import-docx', '@bibliotype/import-epub', '@bibliotype/exporter-epub', '@bibliotype/exporter-pdf', '@bibliotype/adapter-indexeddb'],
  },
});
