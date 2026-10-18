<script setup lang="ts">
/**
 * 文档导入面板（Demo 层）
 *
 * 选择 Markdown / HTML / docx / epub 文件 → detectImportFormat 判格式 → 转 BookDocument → emit('imported')。
 * - 文本类（md / html）：复用静态引入的 @bibliotype/import（importFromText）；
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
    status.value = '无法识别文件格式，请选择 .md / .html / .docx / .epub 文件。';
    return;
  }

  busy.value = true;
  try {
    const title = titleFromName(file.name);
    const metadata = { title };
    let doc: BookDocument;
    if (format === 'markdown' || format === 'html') {
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
        accept=".md,.markdown,.mdown,.mdwn,.html,.htm,.xhtml,.docx,.epub"
        :disabled="busy"
        @change="onFileChange"
      />
      <span>{{ busy ? '导入中…' : '＋ 选择文件（md / html / docx / epub）' }}</span>
    </label>

    <p class="panel__hint">支持 .md / .html / .docx / .epub；docx、epub 按需动态加载对应导入包。</p>
    <p v-if="status" class="panel__status">{{ status }}</p>
  </section>
</template>

<style scoped>
.panel {
  padding: 10px 12px 14px;
  border-block-end: 1px solid var(--demo-border, #e2ddd2);
}

.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 8px;
}

.panel__title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--demo-text, #3c3a34);
}

.panel__file {
  display: block;
  width: 100%;
  padding: 6px 0;
  font-size: 13px;
  text-align: center;
  color: var(--demo-accent, #8c5a2b);
  border: 1px dashed var(--demo-accent, #8c5a2b);
  border-radius: 4px;
  cursor: pointer;
}

.panel__file:hover:not(.panel__file--busy) {
  background: rgba(140, 90, 43, 0.08);
}

.panel__file--busy {
  color: var(--demo-muted, #8a8578);
  border-color: var(--demo-control-border, #d8d2c4);
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
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--demo-muted, #8a8578);
}

.panel__status {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--demo-text, #3c3a34);
}
</style>
