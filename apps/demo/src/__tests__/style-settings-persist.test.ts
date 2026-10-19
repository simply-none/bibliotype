import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { MemoryStyleStore } from '@bibliotype/adapter-indexeddb';
import { useStyleSettings } from '../composables/use-style-settings.js';

const BODY = 'font-size-body';

describe('useStyleSettings 字号持久化', () => {
  it('草稿模式保存字号后，模拟刷新（共享 store + 同 bookId）仍读回 36px', async () => {
    const store = new MemoryStyleStore();
    const bookId = ref('demo');

    const api = useStyleSettings({ bookId, draft: true, store });
    await api.load();
    api.setToken(BODY, '36px');
    expect(api.draftDirty.value).toBe(true);
    await api.applyDraft();

    const saved = await store.load('book:demo');
    expect(saved?.tokens?.[BODY]).toBe('36px');

    const api2 = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await api2.load();
    expect(api2.tokenPatch.value[BODY]).toBe('36px');
  });

  it('首轮加载完成前保存（竞态）：不丢首轮保存', async () => {
    const store = new MemoryStyleStore();
    const bookId = ref('demo');
    const api = useStyleSettings({ bookId, draft: true, store });

    const loadP = api.load();
    api.setToken(BODY, '36px');
    await api.applyDraft();
    await loadP;

    const saved = await store.load('book:demo');
    expect(saved?.tokens?.[BODY]).toBe('36px');

    const api2 = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await api2.load();
    expect(api2.tokenPatch.value[BODY]).toBe('36px');
  });

  it('模拟 App.vue onMounted：先定 bookId 再 load，重载读回', async () => {
    const store = new MemoryStyleStore();
    const currentBookId = ref('demo');

    const api = useStyleSettings({ bookId: currentBookId, draft: true, store });
    // 等价于 onMounted：先定当前书 id，再 load
    currentBookId.value = 'demo';
    const loadP = api.load();
    api.setToken(BODY, '36px');
    await api.applyDraft();
    await loadP;

    // 刷新：新 composable，同 bookId
    const api2 = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await api2.load();
    expect(api2.tokenPatch.value[BODY]).toBe('36px');
  });
});
