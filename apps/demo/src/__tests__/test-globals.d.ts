/**
 * 测试专用的宿主桥全局声明
 *
 * 生产代码（`composables/use-export.ts`）刻意不写 `declare global`：宿主项目往往已
 * 完整声明 `window.ipcRenderer`，重复声明会触发 TS2687 / TS2717。测试里需要直接
 * 赋值 `window.electronPdf` / `window.ipcRenderer`，故把声明收在本文件（`__tests__`
 * 目录在复制到 Electron 项目时整体排除，不会与宿主声明冲突）。
 */
declare global {
  interface Window {
    /** 宿主注入的 PDF 导出桥（Electron preload） */
    electronPdf?: {
      exportPdf: (html: string, options?: unknown) => Promise<Uint8Array>;
    };
    /** 宿主通用 IPC 桥（preload contextBridge） */
    ipcRenderer?: {
      handlePromise: (channel: string, args?: unknown) => Promise<unknown>;
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
      removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
    };
  }
}

export {};
