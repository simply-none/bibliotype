/**
 * 目录面板偏好（展开集合 + 侧栏宽度）
 *
 * 库内（`@bibliotype/vue`）不写存储，`BtToc` 的折叠集合与 `BtSidebarResizer`
 * 的宽度都是受控状态；Demo 作为宿主负责落到 localStorage。
 *
 * 与样式快照（IndexedDB，按书作用域）分开存放：目录折叠与面板宽度是界面偏好，
 * 不属于书稿内容，也不应跟书切换而丢失。
 */
import { ref, watch, type Ref } from 'vue';
import { SIDEBAR_DEFAULT_WIDTH, clampSidebarWidth } from '@bibliotype/vue';

/** localStorage 键 */
export const TOC_PREFS_KEY = 'bibliotype-demo:toc-prefs';

/** 落盘间隔（拖拽期间连续变化，节流后再写） */
const PERSIST_DELAY = 200;

/** 目录偏好快照 */
export interface TocPrefsSnapshot {
  /** 侧栏宽度（px） */
  width: number;
  /** 已展开目录键；缺省表示「用户尚未操作」（目录按全展开呈现） */
  expandedKeys?: string[];
}

/**
 * 解析偏好快照（逐字段容错：坏 JSON / 缺字段 / 非法宽度一律回退默认）
 *
 * @param raw localStorage 原始字符串（`null` 表示未存过）
 */
export function parseTocPrefs(raw: string | null): TocPrefsSnapshot | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<TocPrefsSnapshot>;
  const width =
    typeof candidate.width === 'number' ? clampSidebarWidth(candidate.width) : SIDEBAR_DEFAULT_WIDTH;
  const keys = candidate.expandedKeys;
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
    return { width };
  }
  return { width, expandedKeys: keys };
}

/** useTocPrefs 返回值 */
export interface UseTocPrefsReturn {
  /** 侧栏宽度（px，绑定 `BtSidebarResizer` 的 v-model） */
  width: Ref<number>;
  /** 已展开目录键（`undefined` = 尚未操作，目录全展开） */
  expandedKeys: Ref<string[] | undefined>;
  /** 写入折叠集合（来自 `BtToc` 的 `update:expandedKeys`） */
  setExpandedKeys: (keys: string[]) => void;
  /** 恢复默认宽度（`BtSidebarResizer` 的 reset 事件） */
  resetWidth: () => void;
}

/** 读取 localStorage（不可用环境返回 null） */
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 写入 localStorage（隐私模式 / 配额满时静默忽略） */
function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 存储不可用：不影响功能 */
  }
}

/**
 * 创建目录偏好（读缓存 → 响应式 → 节流写回）
 *
 * @param storageKey localStorage 键（测试可注入独立键）
 */
export function useTocPrefs(storageKey: string = TOC_PREFS_KEY): UseTocPrefsReturn {
  const snapshot = parseTocPrefs(readRaw(storageKey));
  const width = ref(snapshot?.width ?? SIDEBAR_DEFAULT_WIDTH);
  const expandedKeys = ref<string[] | undefined>(snapshot?.expandedKeys);

  let timer: ReturnType<typeof setTimeout> | undefined;
  watch([width, expandedKeys], () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const payload: TocPrefsSnapshot = { width: width.value };
      if (expandedKeys.value !== undefined) payload.expandedKeys = [...expandedKeys.value];
      writeRaw(storageKey, JSON.stringify(payload));
    }, PERSIST_DELAY);
  });

  return {
    width,
    expandedKeys,
    setExpandedKeys: (keys) => {
      expandedKeys.value = [...keys];
    },
    resetWidth: () => {
      width.value = SIDEBAR_DEFAULT_WIDTH;
    },
  };
}
