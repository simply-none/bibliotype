/**
 * Demo 页面提供者集合：横排书页 / 竖排直排书页 / 画册图片 / 上下装订挂历（四向验证）。
 */
import type { PageProvider } from '@bibliotype/page-flip';
import { createAlbumProvider } from './album';
import { createCalendarProvider } from './calendar';
import { createHorizontalTextProvider } from './text-horizontal';
import { createVerticalTextProvider } from './text-vertical';

export interface DemoProviderEntry {
  key: string;
  label: string;
  provider: PageProvider;
}

export function createDemoProviders(): DemoProviderEntry[] {
  return [
    { key: 'horizontal', label: '横排书页', provider: createHorizontalTextProvider() },
    { key: 'vertical', label: '直排书页', provider: createVerticalTextProvider() },
    { key: 'album', label: '画册图片', provider: createAlbumProvider() },
    { key: 'bind-top', label: '上侧装订', provider: createCalendarProvider('top') },
    { key: 'bind-bottom', label: '下侧装订', provider: createCalendarProvider('bottom') },
  ];
}
