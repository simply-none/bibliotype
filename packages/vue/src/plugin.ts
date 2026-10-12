/**
 * Vue 插件：安装后全局注册 bibliotype 组件
 */
import type { App, Plugin } from 'vue';
import BtBookView from './components/BtBookView.vue';
import BtPager from './components/BtPager.vue';
import BtToc from './components/BtToc.vue';

/** 创建插件（全局注册 BtBookView / BtPager / BtToc） */
export function createBibliotype(): Plugin {
  return {
    install(app: App): void {
      app.component('BtBookView', BtBookView);
      app.component('BtPager', BtPager);
      app.component('BtToc', BtToc);
    },
  };
}
