import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { createStyleStore } from '@bibliotype/adapter-indexeddb';
import { useStyleSettings } from '../composables/use-style-settings.js';

const BODY = 'font-size-body';

describe('useStyleSettings 字号持久化（真实 IndexedDB 路径）', () => {
  it('草稿模式保存字号后，模拟刷新（共享连接）仍读回 36px', async () => {
    const store = createStyleStore({ prefer: 'indexeddb' });
    const bookId = ref('demo');

    const api = useStyleSettings({ bookId, draft: true, store });
    await api.load();
    api.setToken(BODY, '36px');
    await api.applyDraft();

    const saved = await store.load('book:demo');
    expect(saved?.tokens?.[BODY]).toBe('36px');

    const api2 = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await api2.load();
    expect(api2.tokenPatch.value[BODY]).toBe('36px');
  });

  it('跨连接（新 store 实例）重载仍读回', async () => {
    const store = createStyleStore({ prefer: 'indexeddb' });
    const bookId = ref('demo');
    const api = useStyleSettings({ bookId, draft: true, store });
    await api.load();
    api.setToken(BODY, '36px');
    await api.applyDraft();
    await store.close();

    const store2 = createStyleStore({ prefer: 'indexeddb' });
    const api2 = useStyleSettings({ bookId: ref('demo'), draft: true, store: store2 });
    await api2.load();
    expect(api2.tokenPatch.value[BODY]).toBe('36px');
  });
});
