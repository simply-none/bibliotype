<script setup lang="ts">
/**
 * 书籍信息编辑态表单
 *
 * 双向绑定父级注入的草稿对象（`draft`）：改基本字段、增删责任者 / 标识符 /
 * 扩展键值。行操作直接对 `draft` 数组 push/splice（同一 reactive 引用），
 * 归一化与补丁生成由 `use-metadata-draft` 在保存时统一处理，本组件不落盘。
 */
import { CLASSICAL_DIVISIONS, EDITION_TYPES, type Identifier } from '@bibliotype/core';
import { schemeText } from '../catalog-export.js';
import type { Draft } from '../composables/use-metadata-draft.js';

const props = defineProps<{ draft: Draft; divisionOptions: readonly string[] }>();

/** 标识符 scheme 候选 */
const IDENTIFIER_SCHEMES: readonly Identifier['scheme'][] = [
  'isbn',
  'issn',
  'doi',
  'cnmarc',
  'other',
];

function addContributor(): void {
  props.draft.contributors.push({ name: '', dynasty: '', role: '' });
}
function removeContributor(index: number): void {
  props.draft.contributors.splice(index, 1);
}
function addIdentifier(): void {
  props.draft.identifiers.push({ scheme: 'other', value: '' });
}
function removeIdentifier(index: number): void {
  props.draft.identifiers.splice(index, 1);
}
function addExtra(): void {
  props.draft.extra.push({ key: '', value: '' });
}
function removeExtra(index: number): void {
  props.draft.extra.splice(index, 1);
}
</script>

<template>
  <div class="dialog__body">
    <section class="dialog__section">
      <h3 class="dialog__section-title">基本信息</h3>
      <label class="field">
        <span class="field__label">题名 *</span>
        <input v-model="draft.title" class="field__input" type="text" placeholder="书名" />
      </label>
      <label class="field">
        <span class="field__label">副题</span>
        <input
          v-model="draft.subtitle"
          class="field__input"
          type="text"
          placeholder="副题 / 并列题名"
        />
      </label>
      <div class="field__grid">
        <label class="field">
          <span class="field__label">语言</span>
          <input v-model="draft.language" class="field__input" type="text" placeholder="zh-Hans" />
        </label>
        <label class="field">
          <span class="field__label">卷数</span>
          <input v-model="draft.volumeCount" class="field__input" type="number" min="0" step="1" />
        </label>
      </div>
      <label class="field">
        <span class="field__label">分类</span>
        <input
          v-model="draft.classification"
          class="field__input"
          type="text"
          placeholder="如：经部·论语"
        />
      </label>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">
        责任者
        <button type="button" class="dialog__add" @click="addContributor">＋ 添加</button>
      </h3>
      <div v-for="(contributor, index) in draft.contributors" :key="index" class="rows__item">
        <input v-model="contributor.name" class="field__input" type="text" placeholder="姓名" />
        <input v-model="contributor.dynasty" class="field__input" type="text" placeholder="朝代" />
        <input v-model="contributor.role" class="field__input" type="text" placeholder="角色" />
        <button
          type="button"
          class="dialog__remove"
          aria-label="删除"
          @click="removeContributor(index)"
        >
          ×
        </button>
      </div>
      <p v-if="draft.contributors.length === 0" class="dialog__empty">暂无责任者</p>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">版本</h3>
      <label class="field">
        <span class="field__label">版本名称</span>
        <input
          v-model="draft.editionName"
          class="field__input"
          type="text"
          placeholder="如：庚辰本"
        />
      </label>
      <div class="field__grid">
        <label class="field">
          <span class="field__label">刊刻年代</span>
          <input v-model="draft.editionEra" class="field__input" type="text" />
        </label>
        <label class="field">
          <span class="field__label">版本性质</span>
          <select v-model="draft.editionKind" class="field__input">
            <option value="">未定</option>
            <option value="base">底本</option>
            <option value="variant">校本</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span class="field__label">刊刻者 / 藏机构</span>
        <input v-model="draft.editionPublisher" class="field__input" type="text" />
      </label>
      <div class="field__grid">
        <label class="field">
          <span class="field__label">版本类型</span>
          <select v-model="draft.editionType" class="field__input">
            <option value="">未定</option>
            <option v-for="item in EDITION_TYPES" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">藏地</span>
          <input
            v-model="draft.repository"
            class="field__input"
            type="text"
            placeholder="如：中国国家图书馆"
          />
        </label>
      </div>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">古籍著录（K7）</h3>
      <div class="field__grid">
        <label class="field">
          <span class="field__label">四部</span>
          <select v-model="draft.division" class="field__input">
            <option value="">未分类</option>
            <option v-for="item in CLASSICAL_DIVISIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">二级类</span>
          <input
            v-model="draft.subdivision"
            class="field__input"
            type="text"
            list="bt-subdivisions"
            placeholder="如：四书类"
          />
          <datalist id="bt-subdivisions">
            <option v-for="item in divisionOptions" :key="item" :value="item" />
          </datalist>
        </label>
      </div>
      <label class="field">
        <span class="field__label">索书号</span>
        <input
          v-model="draft.callNumber"
          class="field__input"
          type="text"
          placeholder="如：善本 12345"
        />
      </label>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">出版</h3>
      <label class="field">
        <span class="field__label">出版社</span>
        <input v-model="draft.pubPublisher" class="field__input" type="text" />
      </label>
      <div class="field__grid">
        <label class="field">
          <span class="field__label">出版年</span>
          <input v-model="draft.pubYear" class="field__input" type="text" />
        </label>
        <label class="field">
          <span class="field__label">出版地</span>
          <input v-model="draft.pubPlace" class="field__input" type="text" />
        </label>
      </div>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">
        标识符
        <button type="button" class="dialog__add" @click="addIdentifier">＋ 添加</button>
      </h3>
      <div v-for="(identifier, index) in draft.identifiers" :key="index" class="rows__item">
        <select v-model="identifier.scheme" class="field__input field__input--scheme">
          <option v-for="scheme in IDENTIFIER_SCHEMES" :key="scheme" :value="scheme">
            {{ schemeText(scheme) }}
          </option>
        </select>
        <input v-model="identifier.value" class="field__input" type="text" placeholder="标识符值" />
        <button
          type="button"
          class="dialog__remove"
          aria-label="删除"
          @click="removeIdentifier(index)"
        >
          ×
        </button>
      </div>
      <p v-if="draft.identifiers.length === 0" class="dialog__empty">暂无标识符</p>
    </section>

    <section class="dialog__section">
      <h3 class="dialog__section-title">
        古籍著录（扩展键值）
        <button type="button" class="dialog__add" @click="addExtra">＋ 添加</button>
      </h3>
      <div v-for="(entry, index) in draft.extra" :key="index" class="rows__item">
        <input v-model="entry.key" class="field__input" type="text" placeholder="键（如 binding）" />
        <input v-model="entry.value" class="field__input" type="text" placeholder="值" />
        <button type="button" class="dialog__remove" aria-label="删除" @click="removeExtra(index)">
          ×
        </button>
      </div>
      <p v-if="draft.extra.length === 0" class="dialog__empty">暂无扩展字段</p>
    </section>
  </div>
</template>

<style scoped>
.dialog__body {
  flex: 1;
  min-height: 0;
  padding: var(--ui-space-3, 8px) var(--ui-space-5, 20px) var(--ui-space-5, 20px);
  overflow-y: auto;
}

.dialog__section {
  margin-block-start: var(--ui-space-4, 12px);
  padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px);
  background: var(--ui-surface-sunken, #e8e1d3);
  border-radius: var(--ui-radius-md, 12px);
}

.dialog__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 var(--ui-space-2, 6px);
  font-size: var(--ui-font-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--ui-accent, #8c5a2b);
}

.dialog__add {
  padding: 1px 8px;
  font-size: var(--ui-font-xs, 11px);
  letter-spacing: 0;
  color: var(--ui-accent, #8c5a2b);
  background: none;
  border: 1px solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-pill, 999px);
  cursor: pointer;
}

.dialog__add:hover {
  background: var(--ui-accent-weak, rgb(140 90 43 / 12%));
}

.dialog__empty {
  margin: 4px 0;
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
}

/* 表单控件 */
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-block: var(--ui-space-2, 6px);
}

.field__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--ui-space-4, 12px);
}

.field__label {
  font-size: var(--ui-font-sm, 12px);
  color: var(--ui-text-muted, #7f7a6d);
}

.field__input {
  min-height: 34px;
  padding: 5px var(--ui-space-2, 6px);
  font-size: var(--ui-font-md, 13px);
  color: var(--ui-text, #3c3a34);
  background: var(--ui-surface-raised, #faf8f4);
  border: var(--ui-border-width, 1px) solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
  transition: border-color var(--ui-dur-fast, 120ms) var(--ui-ease, ease);
}

.field__input:hover {
  border-color: var(--ui-accent, #8c5a2b);
}

.field__input:focus {
  border-color: var(--ui-accent, #8c5a2b);
  outline: none;
}

.field__input--scheme {
  flex: none;
  width: 96px;
}

.rows__item {
  display: flex;
  gap: var(--ui-space-2, 6px);
  align-items: center;
  margin-block: 4px;
}

.rows__item .field__input {
  flex: 1;
  min-width: 0;
}

.dialog__remove {
  flex: none;
  width: 28px;
  height: 28px;
  font-size: 15px;
  line-height: 1;
  color: var(--ui-text-muted, #7f7a6d);
  background: none;
  border: 1px solid var(--ui-border, #e2ddd2);
  border-radius: var(--ui-radius-sm, 8px);
  cursor: pointer;
}

.dialog__remove:hover {
  color: var(--ui-danger, #c0392b);
  border-color: var(--ui-danger, #c0392b);
  background: var(--ui-danger-weak, rgb(192 57 43 / 12%));
}

@media (max-width: 767px) {
  .dialog__body {
    padding: var(--ui-space-3, 8px) var(--ui-space-4, 12px) var(--ui-space-5, 20px);
  }

  .field__grid {
    grid-template-columns: 1fr;
  }

  .field__input {
    min-height: 40px;
    font-size: 14px;
  }
}
</style>
