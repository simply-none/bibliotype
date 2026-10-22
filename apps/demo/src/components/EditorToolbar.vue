<script setup lang="ts">
/**
 * 编辑工具条（Demo 层）
 *
 * 接收 BtEditor 作用域插槽透传的 EditorBinding（binding）：
 * 撤销 / 重做｜正文与标题级别｜引用 / 无序 / 有序列表｜粗 / 斜 / 下划线 / 高亮 /
 * 删除线 / 行内代码 / 链接 / 注音｜专名号 / 书名号 / 圈点 / 异体 / 注Ref / 避讳 /
 * 夹注 / 异体载体 / 避讳载体｜插入双行注 / 眉批 / 校勘记 / 出校符号 / 跋文 / 牌记 /
 * 题记 / 版框 / 鱼尾 / 印章 / 图片 / 表格 / 脚注 / 尾注 / 边注｜下一页｜还原样册。
 * 激活态由 binding.version 驱动（每次事务后重算 isMarkActive / isNodeActive）。
 *
 * 本组件只做「视图与装配」：按钮数据在 `editor-toolbar/`（纯工厂，可脱离组件单测），
 * 触屏折叠在 `composables/use-toolbar-fold.ts`，样式在 `styles/editor-toolbar.css`
 * （经单点 `<style scoped src>` 引入，产物只此一份）。
 *
 * ## 使用说明的落点分工（勿重复也勿遗漏）
 *
 * - **插件包**（`@bibliotype/editor` commands.ts、`@bibliotype/classical/editor`
 *   editor-commands.ts）承载「命令契约」：前置条件、生效落点、返回 false 的原因、
 *   attrs 结构。那是跨 UI 复用的权威口径，改命令语义必须同步那里。
 * - **动作数据**（`editor-toolbar/actions-*.ts`）承载「交互说明」：每个入口的 `usage`
 *   字段（可插拔）——点了做什么、需要什么选区、快捷键、插入后去右侧属性栏补什么、
 *   为什么点了没反应。这些是 demo 的交互决策（如印章走 prompt 录入），不属于插件包 API。
 * - 呈现方式是**鼠标悬浮卡片**（`ToolbarUsageTip`，Vue 组件），不用原生 `title`：
 *   原生提示延迟约 1s、长文案被截断，也装不下「前提 / 落点 / 属性 / 限制」四类信息。
 * - `usage` 传了才有悬浮说明，没传则整块跳过 —— 工具条抽成公共组件后，
 *   由使用方决定是否带说明体系。
 * - 全量表格另见 `docs/19-editor-toolbar-usage.md`（不读代码时的速查页）。
 *
 * 行内标记的通用前提：`toggleMark` 在空光标下写 storedMarks（下次输入继承），
 * 因此「B / I / U / 高亮 / 注音 / 古籍标记」空光标可用；而删除线、行内代码显式传
 * `requireSelection=true`，空光标不执行（避免误清空待输入标记）。
 *
 * 触屏与窄屏（H5 UI 改造 B2）：工具条有近百个入口，平铺在 375px 视口里既挤不进
 * 也靠不上悬浮说明。命中时每行只直出高频动作（撤 / 重 / B / H1 / 注音），
 * 其余收进行尾「更多」，点开展开为单行横滚（按钮 44px 触控目标）。
 */
import { computed, ref } from 'vue';
import { type NamedStyle } from '@bibliotype/core';
import { BtSelectionReplaceMenu, BtTableSizePicker, type EditorBinding } from '@bibliotype/vue';
import { insertTable } from '@bibliotype/editor';
import { ROW_LABELS, useToolbarFold } from '../composables/use-toolbar-fold.js';
import { wheelScrollX } from '../composables/use-toolbar-scroll.js';
import ReplacePanel from './ReplacePanel.vue';
import ToolbarUsageTip from './ToolbarUsageTip.vue';
import { createToolbarActionContext, createToolbarRows } from './editor-toolbar/toolbar-actions.js';
import type { ToolbarAction, ToolbarRow } from './editor-toolbar/toolbar-action-types.js';
import { UTILITY_USAGES } from './editor-toolbar/toolbar-utility-usages.js';
import { REPLACE_TARGET_GROUPS } from './replace-targets.js';

const props = defineProps<{
  binding: EditorBinding;
  readonly?: boolean;
  /** 命名样式（工具条提供批量套用入口；缺省不显示） */
  namedStyles?: readonly NamedStyle[];
}>();
const emit = defineEmits<{ reset: []; 'toggle-readonly': [] }>();

/** 查找替换面板开关（仅编辑态工具条内部状态） */
const searchOpen = ref(false);

/** 只读：禁用全部写操作命令（保留面板展开 / 只读切换自身） */
const isReadonly = computed(() => props.readonly === true);

/**
 * 动作工厂的依赖契约
 *
 * 传 getter 而非快照：`binding` prop 会随作用域插槽重解析换对象，快照会把按钮绑在旧视图上。
 */
const ctx = createToolbarActionContext(() => props.binding);

/** 三行功能区（只依赖命名样式，事务本身不重建节点，激活态由模板逐次求值 active()） */
const TOOLBAR_ROWS = computed<readonly ToolbarRow[]>(() =>
  createToolbarRows(ctx, props.namedStyles),
);

/* ---------- 表格尺寸选择器（Word / WPS 式网格） ---------- */

const tableMenuOpen = ref(false);
const tableAnchor = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const tableTrigger = ref<HTMLElement | null>(null);

/**
 * 工具条按钮点击分发
 *
 * 表格按钮不走「立即插 3×3」，而是记录按钮位置并打开尺寸选择器；
 * 其余按钮保持原行为。用 `key` 而非 label 判定，避免改文案时失效。
 */
function onActionClick(action: ToolbarAction, event: MouseEvent): void {
  if (action.key === 'table') {
    const button = event.currentTarget as HTMLElement | null;
    if (button !== null) {
      const rect = button.getBoundingClientRect();
      tableAnchor.value = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
      tableTrigger.value = button;
    }
    tableMenuOpen.value = !tableMenuOpen.value;
    return;
  }
  action.run();
}

/** 选定尺寸后插入表格（行 / 列已由选择器夹紧到 1~max） */
function onTableSelect(payload: { rows: number; cols: number }): void {
  ctx.execute(insertTable(payload.rows, payload.cols));
  tableMenuOpen.value = false;
}

/* ---------------- H5 触屏折叠（B2） ---------------- */

const { compactToolbar, isRowExpanded, toggleRow, visibleActions, hasFoldedActions } =
  useToolbarFold();

/** 鼠标滚轮（纵向）映射为所在工具行的横向滚动；触控板横向手势保持原生行为 */
function onWheel(event: WheelEvent): void {
  const bar = event.currentTarget as HTMLElement | null;
  if (bar === null) return;
  // 仅当存在横向溢出、且以纵向滚量为主时接管
  const canScrollX = bar.scrollWidth - bar.clientWidth > 1;
  if (!canScrollX || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  wheelScrollX(bar, event);
}
</script>

<template>
  <div class="editor-toolbar" :data-pointer="compactToolbar ? 'touch' : 'mouse'">
    <div
      v-for="row in TOOLBAR_ROWS"
      :key="row.key"
      class="editor-toolbar__row"
      :class="{
        'editor-toolbar__row--readonly': isReadonly,
        'editor-toolbar__row--folded': compactToolbar && !isRowExpanded(row.key),
      }"
      :data-row="row.key"
      :data-folded="compactToolbar && !isRowExpanded(row.key) ? 'true' : 'false'"
      @wheel="onWheel"
    >
      <span
        v-if="row.key === 'insert' && !compactToolbar"
        class="editor-toolbar__row-label"
        title="不消费选区；选中文字请用「替换为」浮动菜单"
      >
        插入空容器（段后）
      </span>
      <ToolbarUsageTip v-for="action in visibleActions(row)" :key="action.label" :usage="action.usage">
        <button
          type="button"
          class="editor-toolbar__button"
          :class="{ 'editor-toolbar__button--active': action.active?.() === true }"
          :title="action.usage === undefined ? action.title : undefined"
          :disabled="isReadonly || action.disabled?.() === true"
          @mousedown.prevent
          @click="onActionClick(action, $event)"
        >
          {{ action.label }}
        </button>
      </ToolbarUsageTip>
      <!-- 触屏折叠开关（B2）：常驻行尾，不随横滚滑走；展开后该行回到全量可横滚 -->
      <button
        v-if="compactToolbar && hasFoldedActions(row)"
        type="button"
        class="editor-toolbar__button editor-toolbar__button--fold"
        :aria-expanded="isRowExpanded(row.key)"
        :aria-label="`${isRowExpanded(row.key) ? '收起' : '展开'}${ROW_LABELS[row.key] ?? '本行'}动作`"
        @mousedown.prevent
        @click="toggleRow(row.key)"
      >
        {{ isRowExpanded(row.key) ? '收起' : '更多' }}
      </button>
      <!-- 实用区固定第二行右端 -->
      <div v-if="row.key === 'insert'" class="editor-toolbar__group editor-toolbar__group--end">
        <ToolbarUsageTip :usage="UTILITY_USAGES['查找替换']">
          <button
            type="button"
            class="editor-toolbar__button"
            :class="{ 'editor-toolbar__button--active': searchOpen }"
            @mousedown.prevent
            @click="searchOpen = !searchOpen"
          >
            查找替换
          </button>
        </ToolbarUsageTip>
        <ToolbarUsageTip :usage="UTILITY_USAGES['只读']">
          <button
            type="button"
            class="editor-toolbar__button"
            :class="{ 'editor-toolbar__button--active': isReadonly }"
            @mousedown.prevent
            @click="emit('toggle-readonly')"
          >
            {{ isReadonly ? '可编辑' : '只读' }}
          </button>
        </ToolbarUsageTip>
        <ToolbarUsageTip :usage="UTILITY_USAGES['还原样册']">
          <button
            type="button"
            class="editor-toolbar__button"
            :disabled="isReadonly"
            @mousedown.prevent
            @click="emit('reset')"
          >
            还原样册
          </button>
        </ToolbarUsageTip>
      </div>
    </div>
  </div>
  <BtTableSizePicker
    v-if="tableMenuOpen && tableAnchor !== null"
    :anchor="tableAnchor"
    :trigger="tableTrigger"
    @select="onTableSelect"
    @close="tableMenuOpen = false"
  />
  <BtSelectionReplaceMenu
    :binding="binding"
    :groups="REPLACE_TARGET_GROUPS"
    :readonly="isReadonly"
  />
  <ReplacePanel
    v-if="searchOpen"
    :binding="binding"
    :readonly="isReadonly"
    @close="searchOpen = false"
  />
</template>

<style scoped src="../styles/editor-toolbar.css"></style>
