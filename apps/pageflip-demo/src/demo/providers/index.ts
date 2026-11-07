/**
 * Demo 页面提供者集合：横排书页 / 竖排直排书页 / 画册图片。
 */
import type { PageProvider } from '../../engine/types';
import { createAlbumProvider } from './album';
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
  ];
}
