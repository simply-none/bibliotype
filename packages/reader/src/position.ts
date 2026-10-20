/**
 * 阅读位置快照
 *
 * 页码会随字号 / 版式 / 屏宽变化而漂移，因此位置以 **core 锚点**（当前页首块）
 * 为准，页码只作锚点失效时的回退。快照可直接存 localStorage / IndexedDB / 远端。
 *
 * 时间由调用方注入（`savedAt`），不在库内取当前时间——保证可测与可回溯。
 */
import { isAnchor, serializeAnchor, type Anchor } from '@bibliotype/core';

/** 位置快照 schema 版本 */
export const READING_POSITION_SCHEMA_VERSION = '1.0.0';

/** 阅读位置快照 */
export interface ReadingPosition {
  /** 快照 schema 版本 */
  schemaVersion: string;
  /** 当前位置锚点（当前页首块；块锚点不依赖字符偏移） */
  anchor: Anchor;
  /** 页码（自 0 起；锚点失效时回退用） */
  pageIndex: number;
  /** 阅读进度（0~1） */
  progress: number;
  /** 保存时间（ISO 8601，由调用方注入） */
  savedAt?: string;
}

/** 创建位置快照 */
export function createReadingPosition(
  anchor: Anchor,
  pageIndex: number,
  progress: number,
  savedAt?: string,
): ReadingPosition {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError('创建阅读位置失败：pageIndex 必须为非负整数。');
  }
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError('创建阅读位置失败：progress 必须在 0~1 之间。');
  }
  const position: ReadingPosition = {
    schemaVersion: READING_POSITION_SCHEMA_VERSION,
    anchor,
    pageIndex,
    progress,
  };
  if (savedAt !== undefined) {
    position.savedAt = savedAt;
  }
  return position;
}

/** 序列化为 JSON（字段顺序固定，输出确定） */
export function serializeReadingPosition(position: ReadingPosition): string {
  const payload: Record<string, unknown> = {
    schemaVersion: position.schemaVersion,
    anchor: {
      type: position.anchor.type,
      nodeId: position.anchor.nodeId,
      ...(position.anchor.type === 'text'
        ? { offset: position.anchor.offset, length: position.anchor.length }
        : {}),
    },
    pageIndex: position.pageIndex,
    progress: position.progress,
  };
  if (position.savedAt !== undefined) {
    payload.savedAt = position.savedAt;
  }
  return JSON.stringify(payload);
}

/**
 * 反序列化位置快照
 *
 * 兼容 `serializeAnchor` 生成的单字符串锚点（`anchor` 可传 string）。
 *
 * @throws TypeError JSON 非法 / 缺字段 / 锚点不合法
 */
export function parseReadingPosition(json: string): ReadingPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError('解析阅读位置失败：不是合法 JSON。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('解析阅读位置失败：必须是对象。');
  }
  const candidate = parsed as Partial<ReadingPosition>;
  if (!isAnchor(candidate.anchor)) {
    throw new TypeError('解析阅读位置失败：anchor 不是合法锚点（需 type / nodeId）。');
  }
  if (
    typeof candidate.pageIndex !== 'number' ||
    !Number.isInteger(candidate.pageIndex) ||
    candidate.pageIndex < 0
  ) {
    throw new TypeError('解析阅读位置失败：pageIndex 必须为非负整数。');
  }
  const progress = typeof candidate.progress === 'number' ? candidate.progress : 0;
  return createReadingPosition(
    candidate.anchor,
    candidate.pageIndex,
    Math.min(1, Math.max(0, progress)),
    typeof candidate.savedAt === 'string' ? candidate.savedAt : undefined,
  );
}

/** 位置快照对应的锚点字符串（调试 / 存储键用） */
export function positionAnchorKey(position: ReadingPosition): string {
  return serializeAnchor(position.anchor);
}
