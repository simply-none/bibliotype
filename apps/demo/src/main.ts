/**
 * Demo 应用入口
 *
 * 引入顺序：组件库样式（@bibliotype/vue）→ 全局基础样式 → 挂载应用。
 */
import { createApp } from 'vue';
import '@bibliotype/vue/style.css';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
