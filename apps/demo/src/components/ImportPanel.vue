<script setup lang="ts">
/**
 * 文档导入面板（Demo 层）
 *
 * 选择 Markdown / HTML / TXT / docx / epub 文件 → detectImportFormat 判格式 → 转 BookDocument → emit('imported')。
 * - 文本类（md / html / txt）：复用静态引入的 @bibliotype/import（importFromText）；
 * - 二进制类（docx / epub）：**按需动态 `import()`** @bibliotype/import-docx / import-epub，
 *   使 mammoth / fflate 等重依赖不进入首屏包体，仅在选中对应格式时才加载；
 * - schema 用与编辑器同款的古典 schema（IR 为纯数据，节点 / 标记集合一致即可安全载入）；
 * - 文件读取（File.text() / arrayBuffer()）与 DOM 属应用侧副作用，集中在本 Demo 组件；
 * - 开关由左栏 tab 体系承担，不再自带关闭按钮。
 */
import { ref } from 'vue';
import { buildClassicalEditorSchema } from '@bibliotype/classical/editor';
import type { BookDocument } from '@bibliotype/core';
import { detectImportFormat, importFromText, titleFromFilename } from '@bibliotype/import';

const emit = defineEmits<{ close: []; imported: [doc: BookDocument] }>();

/** 与编辑器同款 schema（导入产出的 IR 可直接被 BookEditor / Reader 消费） */
const schema = buildClassicalEditorSchema();

/** 面板状态读数（成功 / 错误 / 不支持提示） */
const status = ref('');
/** 是否处理中（读文件 + 转换） */
const busy = ref(false);

/** 文件名 → 书名（去扩展名 + 剥站点尾巴，避免 z-library 等噪声流入导出元数据） */
const titleFromName = titleFromFilename;

/** 选择文件：判定格式 → 文本类走 import、二进制类动态加载对应包，产出 BookDocument */
async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 复位以便重复选择同一文件
  if (file == null) return;
  status.value = '';

  const format = detectImportFormat(file.name);
  if (format === 'unknown') {
    status.value = '无法识别文件格式，请选择 .md / .html / .txt / .docx / .epub 文件。';
    return;
  }

  busy.value = true;
  try {
    const title = titleFromName(file.name);
    const metadata = { title };
    let doc: BookDocument;
    if (format === 'markdown' || format === 'html' || format === 'text') {
      const text = await file.text();
      doc = importFromText(text, format, schema, metadata);
    } else if (format === 'docx') {
      // 动态加载：mammoth 较重，仅在导入 docx 时进入分包
      const { docxToBookDocument } = await import('@bibliotype/import-docx');
      doc = await docxToBookDocument(await file.arrayBuffer(), schema, metadata);
    } else {
      // 动态加载：fflate + @xmldom/xmldom 仅在导入 epub 时进入分包
      const { epubToBookDocument } = await import('@bibliotype/import-epub');
      doc = epubToBookDocument(await file.arrayBuffer(), schema, metadata);
    }
    emit('imported', doc);
    status.value = `已导入《${title}》。`;
  } catch (error) {
    status.value = `导入失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2 class="panel__title">导入</h2>
    </header>

    <label class="panel__file" :class="{ 'panel__file--busy': busy }">
      <input
        type="file"
        class="panel__file-input"
        accept=".md,.markdown,.mdown,.mdwn,.html,.htm,.xhtml,.txt,.text,.docx,.epub"
        :disabled="busy"
        @change="onFileChange"
      />
      <span>{{ busy ? '导入中…' : '＋ 选择文件（md / html / txt / docx / epub）' }}</span>
    </label>

    <p class="panel__hint">支持 .md / .html / .txt / .docx / .epub；docx、epub 按需动态加载对应导入包。</p>
    <p v-if="status" class="panel__status">{{ status }}</p>
  </section>
</template>

<style scoped>
.panel {
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px) var(--ui-space-5, 20px);
  border-block-end: 1px solid var(--ui-divider, #d8d2c4);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: var(--ui-space-3, 8px);
}

.panel__title {
  margin: 0;
  font-size: var(--ui-font-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-text-muted, #7f7a6d);
}

/* 虚线投递区：做成卡片状的面板（圆角 md + accent 轻色底），不再是贴边的细虚线 */
.panel__file {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 0;
  font-size: var(--ui-font-md, 13px);
  text-align: center;
  color: var(--ui-accent, #8c5a2b);
  background: var(--ui-accent-weak, rgba(140, 90, 43, 0.08));
  border: var(--ui-border-width, 1px) dashed var(--ui-accent, #8c5a2b);
  border-radius: var(--ui-radius-md, 12px);
  cursor: pointer;
  transition: background var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.panel__file:hover:not(.panel__file--busy) {
  background: var(--ui-surface-sunken, rgba(140, 90, 43, 0.08));
}

.panel__file--busy {
  color: var(--ui-text-muted, #7f7a6d);
  background: var(--ui-surface-sunken, transparent);
  border-color: var(--ui-border, #e2ddd2);
  cursor: default;
}

/* 隐藏原生 file 控件，仅保留可点击的样式化标签 */
.panel__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.panel__hint {
  margin: var(--ui-space-3, 8px) 0 0;
  font-size: var(--ui-font-xs, 11px);
  line-height: 1.6;
  color: var(--ui-text-muted, #7f7a6d);
}

.panel__status {
  margin: var(--ui-space-3, 8px) 0 0;
  padding: var(--ui-space-2, 6px) var(--ui-space-3, 8px);
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-sunken, #e8e1d3);
  border-radius: var(--ui-radius-sm, 8px);
}
</style>
