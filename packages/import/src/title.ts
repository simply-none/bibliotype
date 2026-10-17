/**
 * 书名清洗（导入侧元数据卫生）
 *
 * 现实出处：z-library / 1lib / libgen 等站点的文件名与 EPUB dc:title 常带
 * `(z-library.sk, 1lib.sk, z-lib.sk)` 这类站点尾巴，导入后直接成为书架 /
 * 京东读书 / 微信读书展示的书名。本工具在导入侧统一剥掉这类噪声，
 * 避免脏元数据流入导出产物。
 */

/**
 * 常见盗版 / 镜像站点尾巴（括号包裹，可出现在书名任意位置）
 *
 * 覆盖 z-library 系（z-library.sk / 1lib.sk / z-lib.sk / b-ok.cc 等）、
 * libgen、安娜档案等常见变体；大小写不敏感。
 */
const SITE_TAIL_RE =
  /\s*[（(]\s*(?:z-?library(?:\.\w+)*|1lib(?:\.\w+)*|z-?lib(?:\.\w+)*|b-?ok(?:\.\w+)*|libgen(?:\.\w+)*|annas-archive(?:\.\w+)*|zlibrary)(?:\s*[,，]\s*(?:z-?library(?:\.\w+)*|1lib(?:\.\w+)*|z-?lib(?:\.\w+)*|b-?ok(?:\.\w+)*|libgen(?:\.\w+)*|annas-archive(?:\.\w+)*|zlibrary))*\s*[)）]\s*/gi;

/** 连续空白折叠为单空格，去首尾空白 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 清洗书名：剥站点尾巴 + 折叠空白
 *
 * 幂等；无站点尾巴时仅做空白折叠。中文书名（含括号书名号）不受影响——
 * 只剥「括号内全是已知站点名（可逗号并列）」的尾巴。
 */
export function sanitizeBookTitle(title: string): string {
  return collapseWhitespace(title.replace(SITE_TAIL_RE, ' '));
}

/**
 * 从文件名推断书名（去扩展名 + 清洗）
 *
 * 供导入面板「未填写书名时按文件名兜底」使用。
 */
export function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return sanitizeBookTitle(base);
}
