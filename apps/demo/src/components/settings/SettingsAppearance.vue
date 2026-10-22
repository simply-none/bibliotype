<script setup lang="ts">
/**
 * 「外观主题」分区（D10）：主题预设令牌 + 字体回退链 + 缺字检查
 *
 * 只读令牌与主题应用，与样式草稿互不影响：点选主题即上抛全量令牌，由父级
 * 收敛为与基线的差量。基线以宿主传入的 `themeBaseTokens` 起底（缺省回退
 * `DEFAULT_THEME`），与 App 同源，避免「恢复默认」把主题色写成默认色。
 */
import { computed } from 'vue';
import { DEFAULT_THEME, FONT_TOKENS, type BookDocument, type ThemeToken } from '@bibliotype/core';
import {
  BtFontFallbackPanel,
  BtGlyphAuditPanel,
  BtThemePanel,
  splitFontFamilyList,
  useGlyphAudit,
} from '@bibliotype/vue';
import { mergeTokens } from './settings-utils.js';

const props = defineProps<{
  /** 当前生效令牌（含夜间覆盖） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 主题基线令牌（不含用户补丁与夜间覆盖，主题预设重置目标） */
  themeBaseTokens?: Readonly<Record<string, string | undefined>>;
  /** 当前文档（缺字检查扫描对象） */
  document?: BookDocument;
}>();

const emit = defineEmits<{
  /** 主题预设应用（全量令牌，由 App 收敛为与基线的差量） */
  'apply-theme-tokens': [tokens: Record<string, string>];
}>();

const themePanelBase = computed<Record<ThemeToken, string>>(() =>
  mergeTokens(props.themeBaseTokens),
);

/** 主题面板令牌：基线 + 当前生效令牌（缺键时用基线补齐，色板不出现空块） */
const themePanelTokens = computed<Record<ThemeToken, string>>(() => {
  const merged: Record<string, string> = { ...themePanelBase.value };
  for (const [key, value] of Object.entries(props.tokens)) {
    if (typeof value === 'string' && value !== '') merged[key] = value;
  }
  return merged as Record<ThemeToken, string>;
});

/** 字体回退链（取正文令牌的 font-family 声明） */
const fontFamilies = computed(() =>
  splitFontFamilyList(
    props.tokens[FONT_TOKENS.BODY] ?? DEFAULT_THEME[FONT_TOKENS.BODY],
  ),
);

/** 回退调试的样例文本：常见字 + 拉丁 + 扩展 B 区（缺字时可直接看出） */
const FONT_SAMPLE_TEXT = '子曰诗云，学而时习之。天地玄黄，宇宙洪荒。ABC 123 𠀋';

/* 缺字检查（K6）：扫描当前文档，按同一字体链判断 */
const glyphAudit = useGlyphAudit({
  document: () => props.document,
  families: fontFamilies,
});
const glyphIssues = glyphAudit.issues;
</script>

<template>
  <p class="panel__hint">
    主题只换纸色与墨色（令牌层），点选即生效、不进样式草稿；字号、行距、页边距等排版偏好不会被主题覆盖，
    「预设管理」里的样式预设同样各管各的。
  </p>
  <BtThemePanel
    :tokens="themePanelTokens"
    :base-tokens="themePanelBase"
    title="主题预设"
    @update:tokens="emit('apply-theme-tokens', $event)"
  />

  <h5 class="panel__group-title">字体回退链</h5>
  <BtFontFallbackPanel
    :text="FONT_SAMPLE_TEXT"
    :families="fontFamilies"
    title="逐字命中与缺字"
  />

  <h5 class="panel__group-title">缺字检查</h5>
  <BtGlyphAuditPanel :issues="glyphIssues" title="当前文档缺字" />
</template>

<style scoped src="../../styles/settings-controls.css"></style>
