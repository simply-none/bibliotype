/**
 * 条件内容表达式
 *
 * `condition` 容器的 `attrs.when` 用受控的键值表达式描述「何时输出该子树」，
 * 例如 `platform=epub&role=teacher`。设计目标：
 * - 纯函数、无副作用、可测试；
 * - 不引入表达式引擎（避免 eval 与安全风险）；
 * - 缺省上下文（未注入）时保留内容 —— 导出 / 阅读器不传上下文不会误删内容。
 *
 * 语法：`key=value` / `key!=value`，多个子句用 `&` 连接（全部为真才输出）。
 * 键为上下文对象字段名；值为裸串或单 / 双引号包裹的串。
 */

/** 条件上下文（平台 / 角色 / 版本等由宿主注入） */
export type ConditionContext = Readonly<Record<string, string | undefined>>;

/** 单个子句 */
interface Clause {
  key: string;
  op: '=' | '!=';
  value: string;
}

/** 解析单个子句（非法返回 undefined） */
function parseClause(raw: string): Clause | undefined {
  const match = /^([A-Za-z][\w-]*)\s*(!=|=)\s*(.+)$/.exec(raw.trim());
  if (match === null) return undefined;
  const key = match[1]!;
  const op = match[2] as '=' | '!=';
  const value = match[3]!.trim().replace(/^["']|["']$/g, '');
  // `platform==epub` 会被宽松匹配成 key=platform、value="=epub"：显式拒绝前导运算符
  if (value === '' || value.startsWith('=') || value.startsWith('!')) return undefined;
  return { key, op, value };
}

/** 表达式是否合法（空串视为合法：无条件） */
export function isValidConditionExpression(when: string): boolean {
  const expr = when.trim();
  if (expr === '') return true;
  const clauses = expr.split('&');
  if (clauses.length === 0) return false;
  return clauses.every((clause) => parseClause(clause) !== undefined);
}

/**
 * 求值条件表达式
 *
 * @param when 表达式（空串表示无条件为真）
 * @param context 上下文；**缺省时返回 true**（保留内容，避免误删）
 * @returns 是否输出该子树；表达式非法时返回 false（保守隐藏并交由校验提示）
 */
export function evaluateCondition(when: string, context?: ConditionContext): boolean {
  const expr = when.trim();
  if (expr === '') return true;
  if (context === undefined) return true;

  const clauses = expr.split('&').map((clause) => clause.trim()).filter((clause) => clause !== '');
  if (clauses.length === 0) return true;

  for (const raw of clauses) {
    const clause = parseClause(raw);
    if (clause === undefined) return false;
    const actual = context[clause.key];
    if (actual === undefined) return false;
    const matched = actual === clause.value;
    if (clause.op === '=' ? !matched : matched) return false;
  }
  return true;
}
