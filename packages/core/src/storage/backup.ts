/**
 * 整库备份 / 迁移：文件规划 + 三策略恢复
 *
 * 与 `.btbook` 共用一套包格式：备份包内每本书是一个独立的 `.btbook`，
 * 因此单书导出与整库导出不会出现两套打包逻辑。
 *
 * 恢复原则：
 * - **逐书串行**：单本失败只进失败清单，不中断整批；
 * - **先校验后写入**：`validateDocument` 不通过的包不落库（避免污染书库）；
 * - **冲突策略显式**：merge（保留较新）/ overwrite（覆盖）/ keep-both（生成副本）。
 */
import type { BookDocument } from '../ir/document.js';
import { validateDocument } from '../ir/validate.js';
import type { AssetStore } from './asset.js';
import { isAssetStore } from './asset.js';
import type { BookPackCodec, BookPackFile, UnpackedBookPack } from './btbook.js';
import { BOOK_PACK_ERROR_CODES, BookPackError, parseBookPackFiles } from './btbook.js';
import { isBookSummaryStore } from './query.js';
import type { DocumentSummary, StorageAdapter } from './types.js';

/** 备份包格式标识 */
export const LIBRARY_BACKUP_FORMAT = 'btbook-library';
/** 备份包格式版本 */
export const LIBRARY_BACKUP_VERSION = '1';

/** 备份包内固定路径 */
export const LIBRARY_BACKUP_FILES = {
  MANIFEST: 'manifest.json',
  /** 单书包目录前缀（`books/<id>.btbook`） */
  BOOKS_PREFIX: 'books/',
  /** 用户设置（任意 JSON） */
  SETTINGS: 'settings.json',
  /** 样式快照（任意 JSON） */
  STYLES: 'styles.json',
} as const;

/** 冲突策略常量 */
export const BACKUP_CONFLICT_STRATEGIES = {
  /** 合并：保留 `updatedAt` 较新的一份 */
  MERGE: 'merge',
  /** 覆盖：以备份内容为准 */
  OVERWRITE: 'overwrite',
  /** 保留双份：导入件另存为「副本」 */
  KEEP_BOTH: 'keep-both',
} as const;

/** 冲突策略联合 */
export type BackupConflictStrategy =
  (typeof BACKUP_CONFLICT_STRATEGIES)[keyof typeof BACKUP_CONFLICT_STRATEGIES];

/** 备份清单中的单书条目 */
export interface LibraryBackupBookEntry {
  /** 原文档 id */
  id: string;
  /** 标题（便于失败清单展示） */
  title: string;
  /** 包内路径 */
  path: string;
}

/** 备份清单 */
export interface LibraryBackupManifest {
  /** 固定为 `btbook-library` */
  format: typeof LIBRARY_BACKUP_FORMAT;
  /** 格式版本 */
  formatVersion: string;
  /** 导出时间（epoch ms，由调用方注入） */
  createdAt: number;
  /** 书目列表 */
  books: LibraryBackupBookEntry[];
  /** 是否包含 settings.json */
  hasSettings: boolean;
  /** 是否包含 styles.json */
  hasStyles: boolean;
}

/** 备份构建输入 */
export interface BuildLibraryBackupInput {
  /** 导出时间（epoch ms） */
  createdAt: number;
  /** 已打包好的单书（`packBookArchive` 产物） */
  books: readonly { id: string; title: string; archive: Uint8Array }[];
  /** 用户设置（任意可 JSON 序列化结构） */
  settings?: unknown;
  /** 样式快照 */
  styles?: unknown;
}

/** 单书档扩展名 */
const BTBOOK_SUFFIX = '.btbook';

/** 单书包在备份包内的路径 */
export function backupBookPath(id: string): string {
  return `${LIBRARY_BACKUP_FILES.BOOKS_PREFIX}${encodeURIComponent(id)}${BTBOOK_SUFFIX}`;
}

/** 从包内路径还原文档 id（非法路径返回 undefined） */
export function backupBookIdFromPath(path: string): string | undefined {
  if (!path.startsWith(LIBRARY_BACKUP_FILES.BOOKS_PREFIX)) {
    return undefined;
  }
  const fileName = path.slice(LIBRARY_BACKUP_FILES.BOOKS_PREFIX.length);
  if (!fileName.endsWith(BTBOOK_SUFFIX)) {
    return undefined;
  }
  const encoded = fileName.slice(0, fileName.length - BTBOOK_SUFFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 构建备份包文件列表（纯函数：不做压缩） */
export function buildLibraryBackupFiles(input: BuildLibraryBackupInput): BookPackFile[] {
  const entries: LibraryBackupBookEntry[] = [];
  const files: BookPackFile[] = [];
  const used = new Set<string>();
  for (const book of input.books) {
    let id = book.id;
    let suffix = 2;
    while (used.has(id)) {
      id = `${book.id}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    const path = backupBookPath(id);
    entries.push({ id: book.id, title: book.title, path });
    files.push({ path, data: book.archive });
  }
  const manifest: LibraryBackupManifest = {
    format: LIBRARY_BACKUP_FORMAT,
    formatVersion: LIBRARY_BACKUP_VERSION,
    createdAt: input.createdAt,
    books: entries,
    hasSettings: input.settings !== undefined,
    hasStyles: input.styles !== undefined,
  };
  const result: BookPackFile[] = [
    { path: LIBRARY_BACKUP_FILES.MANIFEST, data: encodeText(JSON.stringify(manifest)) },
    ...files,
  ];
  if (input.settings !== undefined) {
    result.push({
      path: LIBRARY_BACKUP_FILES.SETTINGS,
      data: encodeText(JSON.stringify(input.settings)),
    });
  }
  if (input.styles !== undefined) {
    result.push({
      path: LIBRARY_BACKUP_FILES.STYLES,
      data: encodeText(JSON.stringify(input.styles)),
    });
  }
  return result;
}

/** 解析备份清单（格式 / 版本不符抛 BookPackError） */
export function parseLibraryBackupManifest(
  files: readonly BookPackFile[],
): LibraryBackupManifest {
  const manifestFile = files.find((file) => file.path === LIBRARY_BACKUP_FILES.MANIFEST);
  if (manifestFile === undefined) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      '备份包缺少 manifest.json，无法识别格式。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.data));
  } catch {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      '备份包 manifest.json 不是合法 JSON，请重新导出。',
    );
  }
  const manifest = parsed as Partial<LibraryBackupManifest>;
  if (manifest.format !== LIBRARY_BACKUP_FORMAT) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_FORMAT,
      `备份包格式标识为 ${String(manifest.format)}，不是 ${LIBRARY_BACKUP_FORMAT}。`,
    );
  }
  if (manifest.formatVersion !== LIBRARY_BACKUP_VERSION) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.UNSUPPORTED_VERSION,
      `备份包格式版本 ${String(manifest.formatVersion)} 不受支持（当前支持 ${LIBRARY_BACKUP_VERSION}）。`,
    );
  }
  const books = Array.isArray(manifest.books)
    ? manifest.books.filter(
        (entry): entry is LibraryBackupBookEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as LibraryBackupBookEntry).id === 'string' &&
          typeof (entry as LibraryBackupBookEntry).path === 'string',
      )
    : [];
  return {
    format: LIBRARY_BACKUP_FORMAT,
    formatVersion: LIBRARY_BACKUP_VERSION,
    createdAt: typeof manifest.createdAt === 'number' ? manifest.createdAt : 0,
    books: books.map((entry) => ({
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title : entry.id,
      path: entry.path,
    })),
    hasSettings: manifest.hasSettings === true,
    hasStyles: manifest.hasStyles === true,
  };
}

/** 恢复进度事件 */
export interface LibraryRestoreProgress {
  /** 阶段：读取清单后的逐书处理 / 收尾 */
  phase: 'restoring' | 'done';
  /** 已完成数量 */
  current: number;
  /** 总数 */
  total: number;
  /** 当前书 id */
  id?: string;
  /** 当前书标题 */
  title?: string;
}

/** 恢复失败条目 */
export interface LibraryRestoreFailure {
  /** 原文档 id */
  id: string;
  /** 标题（清单提供时） */
  title?: string;
  /** 错误码（书档错误码或 `INVALID_DOCUMENT` / `SAVE_FAILED`） */
  code: string;
  /** 中文说明 */
  message: string;
}

/** 单书恢复成功后的回调（宿主据此落盘注记、封面等域外数据） */
export type LibraryRestoreBookHook = (context: {
  /** 写入后的文档 id（保留双份时可能与原 id 不同） */
  targetId: string;
  /** 原文档 id */
  sourceId: string;
  /** IR 文档 */
  document: BookDocument;
  /** 书档内的注记集合（未包含时为 undefined） */
  annotations: unknown;
}) => Promise<void>;

/** 恢复选项 */
export interface RestoreLibraryOptions {
  /** 备份包文件（已解压） */
  files: readonly BookPackFile[];
  /** 压缩端口（用于解开单书 `.btbook`） */
  codec: BookPackCodec;
  /** 目标存储（资产能力可选） */
  target: StorageAdapter & Partial<AssetStore>;
  /** 冲突策略（默认 merge） */
  strategy?: BackupConflictStrategy;
  /** 进度回调（逐书触发） */
  onProgress?: (progress: LibraryRestoreProgress) => void;
  /** 单书恢复后的钩子（注记等） */
  onBookRestored?: LibraryRestoreBookHook;
  /** 是否执行 IR 校验（默认 true；关闭仅用于已知可信来源） */
  validate?: boolean;
}

/** 恢复结果 */
export interface LibraryRestoreResult {
  /** 新写入 / 覆盖的文档 id */
  restored: string[];
  /** 按策略跳过的文档 id */
  skipped: string[];
  /** 保留双份时的新旧 id 对照 */
  copies: { sourceId: string; id: string }[];
  /** 失败清单（不中断整批） */
  failures: LibraryRestoreFailure[];
  /** 备份内的用户设置 */
  settings?: unknown;
  /** 备份内的样式快照 */
  styles?: unknown;
}

/** 解析包内任意 JSON 文件 */
function readOptionalJson(files: readonly BookPackFile[], path: string): unknown {
  const file = files.find((item) => item.path === path);
  if (file === undefined) {
    return undefined;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.data));
}

/** 生成不冲突的副本 id（`<id>-copy`、`<id>-copy-2`…） */
export function nextCopyId(id: string, taken: ReadonlySet<string>): string {
  const base = `${id}-copy`;
  if (!taken.has(base)) {
    return base;
  }
  let index = 2;
  while (taken.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

/**
 * 按策略决定写入 id
 *
 * @returns `{ action: 'write', id }` / `{ action: 'skip' }`
 */
export function resolveConflictTarget(options: {
  id: string;
  updatedAt: number;
  existing: ReadonlyMap<string, DocumentSummary>;
  taken: ReadonlySet<string>;
  strategy: BackupConflictStrategy;
}): { action: 'write'; id: string } | { action: 'skip' } {
  const current = options.existing.get(options.id);
  if (current === undefined) {
    return { action: 'write', id: options.id };
  }
  switch (options.strategy) {
    case BACKUP_CONFLICT_STRATEGIES.OVERWRITE:
      return { action: 'write', id: options.id };
    case BACKUP_CONFLICT_STRATEGIES.KEEP_BOTH:
      return { action: 'write', id: nextCopyId(options.id, options.taken) };
    case BACKUP_CONFLICT_STRATEGIES.MERGE:
    default:
      if (options.updatedAt > current.updatedAt) {
        return { action: 'write', id: options.id };
      }
      return { action: 'skip' };
  }
}

/** 从备份包恢复书库 */
export async function restoreLibrary(
  options: RestoreLibraryOptions,
): Promise<LibraryRestoreResult> {
  const strategy = options.strategy ?? BACKUP_CONFLICT_STRATEGIES.MERGE;
  const manifest = parseLibraryBackupManifest(options.files);
  const existingList = await options.target.list();
  const existing = new Map(existingList.map((summary) => [summary.id, summary]));
  const taken = new Set(existingList.map((summary) => summary.id));
  const assetStore = isAssetStore(options.target) ? options.target : undefined;
  const summaryStore = isBookSummaryStore(options.target) ? options.target : undefined;

  const result: LibraryRestoreResult = {
    restored: [],
    skipped: [],
    copies: [],
    failures: [],
  };
  const settings = readOptionalJson(options.files, LIBRARY_BACKUP_FILES.SETTINGS);
  if (settings !== undefined) {
    result.settings = settings;
  }
  const styles = readOptionalJson(options.files, LIBRARY_BACKUP_FILES.STYLES);
  if (styles !== undefined) {
    result.styles = styles;
  }

  const total = manifest.books.length;
  let current = 0;
  for (const entry of manifest.books) {
    current += 1;
    const archive = options.files.find((file) => file.path === entry.path);
    if (archive === undefined) {
      result.failures.push({
        id: entry.id,
        title: entry.title,
        code: BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
        message: `备份包缺少 ${entry.path}，已跳过该本。`,
      });
    } else {
      try {
        const unpacked = await unpackBookArchiveForRestore(archive.data, options.codec);
        if (options.validate !== false) {
          const validation = validateDocument(unpacked.document);
          if (!validation.ok) {
            const first = validation.errors[0];
            throw new BookPackError(
              BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT,
              `《${entry.title}》校验未通过：${first?.message ?? '文档结构不合法'}（${first?.path ?? 'root'}）。`,
            );
          }
        }
        const decision = resolveConflictTarget({
          id: unpacked.manifest.id,
          updatedAt: unpacked.summary.updatedAt,
          existing,
          taken,
          strategy,
        });
        if (decision.action === 'skip') {
          result.skipped.push(entry.id);
        } else {
          for (const asset of unpacked.assets) {
            if (assetStore !== undefined) {
              await assetStore.putAsset(asset.id, asset.payload);
            }
          }
          await options.target.save(decision.id, unpacked.document, {
            updatedAt: unpacked.summary.updatedAt,
          });
          if (summaryStore !== undefined) {
            await summaryStore.updateSummary(decision.id, {
              tags: unpacked.summary.tags,
              coverThumbnail: unpacked.summary.coverThumbnail,
              progress: unpacked.summary.progress,
              lastOpenedAt: unpacked.summary.lastOpenedAt,
            });
          }
          taken.add(decision.id);
          existing.set(decision.id, { ...unpacked.summary, id: decision.id });
          result.restored.push(decision.id);
          if (decision.id !== unpacked.manifest.id) {
            result.copies.push({ sourceId: unpacked.manifest.id, id: decision.id });
          }
          if (options.onBookRestored !== undefined) {
            await options.onBookRestored({
              targetId: decision.id,
              sourceId: unpacked.manifest.id,
              document: unpacked.document,
              annotations: unpacked.annotations,
            });
          }
        }
      } catch (error) {
        result.failures.push({
          id: entry.id,
          title: entry.title,
          code: error instanceof BookPackError ? error.code : 'RESTORE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    options.onProgress?.({
      phase: 'restoring',
      current,
      total,
      id: entry.id,
      title: entry.title,
    });
  }

  options.onProgress?.({ phase: 'done', current: total, total });
  return result;
}

/** 解包单书（独立函数便于在恢复循环内单独 try/catch） */
async function unpackBookArchiveForRestore(
  data: Uint8Array,
  codec: BookPackCodec,
): Promise<UnpackedBookPack> {
  const files = await codec.unzip(data);
  return parseBookPackFiles(files);
}

/** 便捷：把一组书打包成备份单文件 */
export async function packLibraryArchive(
  input: BuildLibraryBackupInput,
  codec: BookPackCodec,
): Promise<Uint8Array> {
  return codec.zip(buildLibraryBackupFiles(input));
}

/** 便捷：从备份单文件恢复（先解压整包） */
export async function unpackLibraryArchive(
  data: Uint8Array,
  codec: BookPackCodec,
  options: Omit<RestoreLibraryOptions, 'files' | 'codec'>,
): Promise<LibraryRestoreResult> {
  const files = await codec.unzip(data);
  return restoreLibrary({ ...options, files, codec });
}


