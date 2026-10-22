/**
 * 应用图标路径表（P0）
 *
 * 与 `components/AppIcon.vue` 分开存放的原因：
 * - `<script setup>` 里不能 `export`，而宿主需要在自己的常量表（如 `ASIDE_TABS`）
 *   里给每个入口标注图标名，就得有一个能 import 的类型；
 * - 图标是纯数据，放模块里可被测试直接断言（名字齐全、路径合法）。
 *
 * 口径：统一 24 × 24 栅格、描边式（`stroke="currentColor"`），
 * 新增图标只往表里加一条，不改组件。
 */
export const APP_ICON_PATHS = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  toc: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  check: ['M20 6 9 17l-5-5'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  library: ['M4 4v16', 'M8 4v16', 'M12 4v16', 'M17 4l4 16'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M16 3h3a2 2 0 0 1 2 2v3', 'M16 21h3a2 2 0 0 0 2-2v-3', 'M8 21H5a2 2 0 0 1-2-2v-3'],
  compare: ['M3 5h7v14H3z', 'M14 5h7v14h-7z'],
  share: ['M4 12v8h16v-8', 'M12 3v13', 'M8 7l4-4 4 4'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M4 3h16'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'],
  palette: ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 0-8 9 9 0 0 0-4-1z', 'M7 9h.01', 'M10 6h.01', 'M16 7h.01'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
  collapse: ['m6 9 6 6 6-6'],
  expand: ['m18 15-6-6-6 6'],
} as const;

/** 图标名（由路径表的键推导，新增图标自动进类型） */
export type AppIconName = keyof typeof APP_ICON_PATHS;

/** 全部图标名（测试与文档用） */
export const APP_ICON_NAMES: readonly AppIconName[] = Object.keys(
  APP_ICON_PATHS,
) as AppIconName[];
