/**
 * Demo 站点 Vite 配置
 *
 * 应用构建（非库模式）：Vue 插件 + 默认产物目录 dist。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
});
