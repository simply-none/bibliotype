/**
 * 块插入与符号动作（工具条第三行）
 *
 * 纯工厂：入参只有依赖契约，返回值即按钮数据，可脱离组件单测。
 * 文本（`label` / `title` / `usage`）与 `docs/19-editor-toolbar-usage.md` 速查表同源，改一处需同步另一处。
 */
import { NODE_TYPES } from '@bibliotype/core';
import {
  insertBlockOfType,
  insertImage,
  insertPageBreak,
  insertTable,
  mergeCells,
  splitCell,
} from '@bibliotype/editor';
import {
  insertBorderFrame,
  insertCollationNote,
  insertCollationSymbol,
  insertColophon,
  wrapDoubleNote,
  insertFishTail,
  insertHeadNote,
  insertImprint,
  insertSeal,
  insertTailNote,
} from '@bibliotype/classical/editor';
import type { ToolbarAction, ToolbarActionContext } from './toolbar-action-types.js';

/**
 * 块插入与符号
 *
 * 两类落点，别混：
 * - **段后插入空容器**（双行注 / 眉批 / 校勘记 / 跋文 / 牌记 / 题记 / 版框 / 鱼尾 / 表格 /
 *   脚注 / 尾注 / 边注）：以「当前叶块之后」为插入点，光标随即进入新容器，
 *   **不消费选区**；
 * - **光标处插入**（出校符号 / 印章 / 图片）：按 `replaceSelectionWith` 替换当前选区。
 *
 * 选中文字的转换不在这里：选中后由 `BtSelectionReplaceMenu`（【替换为】浮动菜单）
 * 消费选区、把文字搬进目标容器；本行按钮只负责「新建空容器 / 光标处原子插入」。
 * 另有「下一页」：在光标处插分页符（段中则一分为二），靠分页器的 breakAfter 断页（非容器插入）。
 * 容器类内容的可编辑性、样式全在 `book-css.ts`；`rawAttrs` 兜底保证未知属性往返无损。
 */
export function createInsertActions(ctx: ToolbarActionContext): readonly ToolbarAction[] {
  return [
    {
      label: '下一页',
      run: () => ctx.execute(insertPageBreak()),
      title: '在光标处插入分页符：光标后的内容另起一页，光标落在新页首位',
      usage: {
        use: '从光标处强行断页：新增一页，光标落到新页第一个可输入位置',
        where:
          '光标在段中 / 段尾 → 该段一分为二，后半起新页；光标在段首 → 整段移到新页（均不留空白段）',
        attrs: 'break.variant = page（分页符，不是普通分隔线 hr / dashed）',
        limit:
          '横排 / 直排同一逻辑；分页符在页内渲染为一条分隔线（横排横线、直排竖线），点错可整笔撤销（Mod-Z）',
      },
    },
    {
      label: '双行夹注',
      run: () => ctx.execute(wrapDoubleNote()),
      title: '在光标处插入双行夹注（行内随文连排）',
      usage: {
        use: '插入行内双行夹注（古籍口径：小字≈正文之半、随文连排不换列）',
        where: '光标所在段落内；有选区则包裹选中文字',
        attrs: '夹注内容直接在行内编辑；跨段选区不生效',
        limit: '插入位置跟随光标所在段落，不是文档末尾',
      },
    },
    {
      label: '眉批',
      run: () => ctx.execute(insertHeadNote()),
      title: '在当前段落之后插入眉批',
      usage: {
        use: '插入眉批容器（页眉上方批注位）',
        where: '当前叶块之后；光标进入新容器',
        limit: '版心外的落位由分页与样式表决定，编辑态按块顺序显示',
      },
    },
    {
      label: '校勘记',
      run: () => ctx.execute(insertCollationNote()),
      title: '在当前段落之后插入校勘记',
      usage: {
        use: '插入校勘记容器',
        where: '当前叶块之后；光标进入新容器',
        limit: '与「出校符号」配合使用：符号在正文，记文在此容器',
      },
    },
    {
      label: '出校符号',
      run: () => ctx.executeReplacingSelection(() => insertCollationSymbol()),
      title: '在光标处插入出校符号（○）',
      usage: {
        use: '在光标处插入出校符号 ○',
        where: '光标处（替换选区）',
        attrs: 'collation-mark.symbol（可改为 □ / △ 等）',
        limit: '符号渲染依赖 `.bt-collation-mark::after{content:attr(data-symbol)}`',
      },
    },
    {
      label: '跋文',
      run: () => ctx.execute(insertTailNote()),
      title: '在当前段落之后插入跋文',
      usage: {
        use: '插入跋文容器',
        where: '当前叶块之后；光标进入新容器',
        limit: '多用于书末，节点本身没有位置约束',
      },
    },
    {
      label: '牌记',
      run: () => ctx.execute(insertImprint()),
      title: '在当前段落之后插入牌记',
      usage: {
        use: '插入牌记容器（刊刻信息）',
        where: '当前叶块之后；光标进入新容器',
      },
    },
    {
      label: '题记',
      run: () => ctx.execute(insertColophon()),
      title: '在当前段落之后插入题记',
      usage: {
        use: '插入题记容器（跋语 / 题识）',
        where: '当前叶块之后；光标进入新容器',
      },
    },
    {
      label: '版框',
      run: () => ctx.execute(insertBorderFrame()),
      title: '在当前段落之后插入版框',
      usage: {
        use: '插入版框容器（四周界线）',
        where: '当前叶块之后；光标进入新容器',
        limit: '版框的边线样式由样式表控制，容器本身只是语义块',
      },
    },
    {
      label: '鱼尾',
      run: () => ctx.execute(insertFishTail()),
      title: '在当前段落之后插入鱼尾',
      usage: {
        use: '插入鱼尾（版心中缝的鱼形装饰）',
        where: '当前叶块之后',
        limit: '无内容原子块：不可在块内输入，外观由 `.bt-fish-tail::after` 提供',
      },
    },
    {
      label: '印章',
      run: () => {
        const text = ctx.promptText('印文（取消则不插入，确定留空用占位）');
        if (text !== null) {
          ctx.executeReplacingSelection(() => insertSeal(text || undefined));
        }
      },
      title: '在光标处插入印章',
      usage: {
        use: '在光标处插入印章，弹窗录入印文（取消则不插入）',
        where: '光标处（替换选区）',
        attrs: 'seal.text（印文；留空确定则用「印章」占位，之后可在属性栏改）',
        limit: '印文只存在 attrs，元素本身无文本 —— 显示依赖 `.bt-seal::after`',
      },
    },
    {
      label: '图片',
      run: () => {
        const src = ctx.promptText('图片地址（留空用占位图）', '');
        if (src !== null) {
          ctx.executeReplacingSelection(() => insertImage({ src: src || undefined, alt: '' }));
        }
      },
      title: '在光标处插入图片（src / alt 可在属性栏修改）',
      usage: {
        use: '在光标处插入图片，弹窗录入图片地址（取消则不插入）',
        where: '光标处（替换选区）',
        attrs: 'image.src / image.alt（alt 默认空串，插入后补）',
        limit: '地址留空则用 1×1 占位图；外链地址不会随 EPUB 导出打包',
      },
    },
    {
      key: 'table',
      label: '表格',
      run: () => ctx.execute(insertTable(3, 3)),
      title: '选择行 × 列后插入表格',
      usage: {
        use: '打开行 × 列网格：悬停实时高亮尺寸，点击直接插入；也可输入精确行列后点「插入」',
        where: '当前叶块之后；单元格内嵌空段落',
        limit: '简化表格模型：无跨行 / 跨列 / 表头属性；横排 / 直排均可插入',
      },
    },
    {
      label: '合并单元格',
      run: () => ctx.execute(mergeCells),
      disabled: () => ctx.selectionEmpty(),
      title: '合并选中矩形区域内的单元格（需非矩形选区覆盖 ≥2 格）',
      usage: {
        use: '选中跨行 / 跨列的矩形区域后点击，左上格保留、其余格内容并入并清除',
        require: '选区须覆盖至少两个单元格且为矩形、不跨表头行',
        where: '当前表格内（table-cell → table-row → table）',
        limit: '非矩形或跨表头冲突时静默不生效；合并后 colspan / rowspan 分别取区域列数 / 行数',
      },
    },
    {
      label: '拆分单元格',
      run: () => ctx.execute(splitCell),
      title: '把光标所在的合并单元格拆回独立空单元格',
      usage: {
        use: '光标置于带 colspan / rowspan 的单元格内点击；首格保留原内容，其余还原为空',
        require: '光标须在已合并的单元格内；普通单元格（跨度 1×1）静默不生效',
        where: '当前表格内',
        limit: '拆分按跨度的列数 × 行数补齐空单元格，不递归拆分其子合并',
      },
    },
    {
      label: '脚注',
      run: () => ctx.execute(insertBlockOfType(NODE_TYPES.FOOTNOTE)),
      title: '在当前段落之后插入脚注',
      usage: {
        use: '插入脚注容器',
        where: '当前叶块之后；光标进入新容器',
        limit: '与正文的关联靠「注Ref」标记，二者需手动配对',
      },
    },
    {
      label: '尾注',
      run: () => ctx.execute(insertBlockOfType(NODE_TYPES.ENDNOTE)),
      title: '在当前段落之后插入尾注',
      usage: {
        use: '插入尾注容器',
        where: '当前叶块之后；光标进入新容器',
        limit: '导出 EPUB 时按块顺序输出，不做自动编号',
      },
    },
    {
      label: '边注',
      run: () => ctx.execute(insertBlockOfType(NODE_TYPES.MARGIN_NOTE)),
      title: '在当前段落之后插入边注',
      usage: {
        use: '插入边注（页边小字）容器',
        where: '当前叶块之后；光标进入新容器',
        limit: '直排 / 横排的边注落位不同，由样式表与分页决定',
      },
    },
  ];
}
