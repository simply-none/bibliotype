/**
 * 引擎测试桩：最小 PageProvider —— 无内容渲染依赖，仅供状态机测试。
 * （真实样张 provider 属于应用内容层，不入包。）
 */
import type { BindEdge, PageProvider } from '../types.js';

export interface StubProviderOptions {
  pageCount?: number;
  aspect?: number;
  orientation?: 'ltr' | 'rtl';
  /** 装订侧（缺省由 orientation 映射）。 */
  bindEdge?: BindEdge;
}

export function createStubProvider(options: StubProviderOptions = {}): PageProvider {
  const pageCount = options.pageCount ?? 6;
  const aspect = options.aspect ?? 0.68;
  const orientation = options.orientation ?? 'ltr';
  return {
    pageCount,
    aspect,
    orientation,
    ...(options.bindEdge ? { bindEdge: options.bindEdge } : {}),
    ready: Promise.resolve(),
    renderPage(ctx, pageIndex, width, height) {
      ctx.fillStyle = '#f2ede0';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#333';
      ctx.font = `${Math.round(height * 0.08)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(pageIndex + 1), width / 2, height / 2);
    },
  };
}
