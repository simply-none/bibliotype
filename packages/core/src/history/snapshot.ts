/**
 * 历史版本（C7）：快照契约、保留策略与回滚校验
 *
 * - 快照走可选端口 `DocumentVersionStore`（与 `StorageAdapter` 并列，运行期探测）；
 * - 快照带内容校验和，回滚前先校验校验和再 `validateDocument`，双保险；
 * - 保留策略只做**选择**（哪些该删），实际删除由存储实现执行；
 * - 时间一律由调用方注入，便于测试与回溯。
 */
import type { BookDocument } from '../ir/document.js';
import { validateDocument } from '../ir/validate.js';
import type { DocumentIssue } from '../ir/validate.js';
import { hashAssetBytes } from '../storage/asset.js';

/** 快照记录格式版本 */
export const DOCUMENT_SNAPSHOT_VERSION = 1;

/** 快照元信息（列表展示，不含正文） */
export interface DocumentSnapshotMeta {
  /** 所属文档 id */
  documentId: string;
  /** 版本号（同一文档内单调递增） */
  version: number;
  /** 版本标签（如「投稿前」；可缺省） */
  label?: string;
  /** 创建时间（epoch ms） */
  createdAt: number;
  /** 字数（创建时统计，避免列表遍历正文） */
  wordCount?: number;
}

/** 完整快照（元信息 + 正文） */
export interface DocumentSnapshot extends DocumentSnapshotMeta {
  /** 记录格式版本 */
  formatVersion: number;
  /** 正文内容校验和（FNV-1a，用于检测篡改 / 损坏） */
  checksum: string;
  /** IR 文档 */
  document: BookDocument;
}

/** 版本存储端口（可选能力） */
export interface DocumentVersionStore {
  /** 适配器名称 */
  readonly name: string;
  /** 列出某文档的快照元信息（按版本升序） */
  listVersions(documentId: string): Promise<DocumentSnapshotMeta[]>;
  /** 保存快照（同文档同版本覆盖） */
  saveVersion(snapshot: DocumentSnapshot): Promise<DocumentSnapshotMeta>;
  /** 读取快照（未命中返回 undefined） */
  loadVersion(documentId: string, version: number): Promise<DocumentSnapshot | undefined>;
  /** 删除快照（返回是否删除成功） */
  deleteVersion(documentId: string, version: number): Promise<boolean>;
  /** 按策略清理过期快照，返回被删除的版本号 */
  pruneVersions(
    documentId: string,
    policy: SnapshotRetentionPolicy,
  ): Promise<number[]>;
}

/** 运行期判定对象是否实现了版本端口 */
export function isDocumentVersionStore(value: unknown): value is DocumentVersionStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DocumentVersionStore>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.listVersions === 'function' &&
    typeof candidate.saveVersion === 'function' &&
    typeof candidate.loadVersion === 'function' &&
    typeof candidate.deleteVersion === 'function' &&
    typeof candidate.pruneVersions === 'function'
  );
}

/**
 * 保留策略
 *
 * 两个条件同时给出时取**更严格**者（既保留最近 N 份，也不保留超过 N 天的）。
 * `now` 显式传入，避免依赖当前时间。
 */
export interface SnapshotRetentionPolicy {
  /** 最多保留份数（>= 1） */
  maxCount?: number;
  /** 最长保留天数（>= 1） */
  maxAgeDays?: number;
  /** 当前时间（epoch ms，调用方注入） */
  now: number;
}

/** 校验策略参数（非法值抛 RangeError，避免静默清空全部历史） */
export function assertRetentionPolicy(policy: SnapshotRetentionPolicy): void {
  if (policy.maxCount !== undefined && (!Number.isInteger(policy.maxCount) || policy.maxCount < 1)) {
    throw new RangeError('保留策略非法：maxCount 必须是 >= 1 的整数。');
  }
  if (
    policy.maxAgeDays !== undefined &&
    (!Number.isFinite(policy.maxAgeDays) || policy.maxAgeDays < 1)
  ) {
    throw new RangeError('保留策略非法：maxAgeDays 必须 >= 1。');
  }
  if (policy.maxCount === undefined && policy.maxAgeDays === undefined) {
    throw new RangeError('保留策略非法：maxCount 与 maxAgeDays 至少给一个，否则不会清理任何快照。');
  }
}

/** 计算快照内容校验和（只对正文，不含元信息与标签） */
export function snapshotChecksum(document: BookDocument): string {
  const text = JSON.stringify({ root: document.root, metadata: document.metadata });
  return hashAssetBytes(new TextEncoder().encode(text));
}

/**
 * 创建快照
 *
 * 文档本身不含「书库 id」（IR 只管内容），因此快照层面单独记录 `documentId`；
 * `version` 由调用方按 `nextSnapshotVersion` 计算后传入，保证确定性。
 */
export function createSnapshot(input: {
  documentId: string;
  document: BookDocument;
  version: number;
  createdAt: number;
  label?: string;
  wordCount?: number;
}): DocumentSnapshot {
  const snapshot: DocumentSnapshot = {
    formatVersion: DOCUMENT_SNAPSHOT_VERSION,
    documentId: input.documentId,
    version: input.version,
    createdAt: input.createdAt,
    checksum: snapshotChecksum(input.document),
    document: input.document,
  };
  if (input.label !== undefined && input.label !== '') {
    snapshot.label = input.label;
  }
  if (input.wordCount !== undefined) {
    snapshot.wordCount = input.wordCount;
  }
  return snapshot;
}

/** 下一个版本号（空历史从 1 开始） */
export function nextSnapshotVersion(metas: readonly DocumentSnapshotMeta[]): number {
  let max = 0;
  for (const meta of metas) {
    if (meta.version > max) {
      max = meta.version;
    }
  }
  return max + 1;
}

/** 选择应清理的快照（保留最近的与未过期的） */
export function selectExpiredSnapshots(
  metas: readonly DocumentSnapshotMeta[],
  policy: SnapshotRetentionPolicy,
): DocumentSnapshotMeta[] {
  assertRetentionPolicy(policy);
  const sorted = [...metas].sort((left, right) => right.version - left.version);
  const expired: DocumentSnapshotMeta[] = [];
  sorted.forEach((meta, index) => {
    const tooMany = policy.maxCount !== undefined && index >= policy.maxCount;
    const tooOld =
      policy.maxAgeDays !== undefined &&
      policy.now - meta.createdAt > policy.maxAgeDays * 24 * 60 * 60 * 1000;
    if (tooMany || tooOld) {
      expired.push(meta);
    }
  });
  // 按版本升序返回，便于存储侧从旧到新清理且结果稳定
  return expired.sort((left, right) => left.version - right.version);
}

/** 回滚结果 */
export type SnapshotRestoreResult =
  | { ok: true; document: BookDocument }
  | { ok: false; code: 'CHECKSUM_MISMATCH' | 'INVALID_DOCUMENT'; issues: DocumentIssue[]; message: string };

/**
 * 回滚校验：先验校验和，再走 `validateDocument`
 *
 * 校验失败不返回文档，调用方据此拒绝回滚并提示，避免把坏文档写进书库。
 */
export function restoreSnapshot(snapshot: DocumentSnapshot): SnapshotRestoreResult {
  const checksum = snapshotChecksum(snapshot.document);
  if (checksum !== snapshot.checksum) {
    return {
      ok: false,
      code: 'CHECKSUM_MISMATCH',
      issues: [],
      message: `版本 ${snapshot.version} 的内容校验和不匹配，快照可能已损坏，请改选其他版本。`,
    };
  }
  const validation = validateDocument(snapshot.document);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID_DOCUMENT',
      issues: validation.errors,
      message: `版本 ${snapshot.version} 未通过 IR 校验：${validation.errors[0]?.message ?? '结构不合法'}。`,
    };
  }
  return { ok: true, document: snapshot.document };
}
