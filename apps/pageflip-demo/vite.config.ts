/**
 * 仿真翻页 Demo 的 Vite 配置
 *
 * 应用构建（非库模式）：Vue 插件 + 默认产物目录 dist。
 * 引擎（src/engine）不依赖任何工作区包，独立可运行；
 * 未来提升为独立 package 时可直接整体迁出。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [vue()],
});
