/* 主题切换净版设置（用后即删） */
const fs = require('fs');

// ============ 1. use-style-settings：resetForThemeSwitch ============
{
  const p = 'apps/demo/src/composables/use-style-settings.ts';
  let src = fs.readFileSync(p, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const j = (...l) => l.join(EOL);

  // 方法（插在 resetAll 之前）
  const a1 = j(
    '  /** 恢复全部默认（本书作用域清空，并删除已存快照）',
  );
  const n1 = j(
    '  /**',
    '   * 主题切换净版（F-设置残留）：清空令牌补丁与功能样式，使命名样式 / 编辑',
    '   * 行为 / 夜间配色保留。',
    '   *',
    '   * 版式度量令牌（字号 / 行高 / 字距 / 缩进 / 字体族）与功能样式的块级声明',
    '   * 和书写方向强耦合——横排调的值残留到直排 / 仿真会破坏字位网格与界行',
    '   * 对齐（列距 / 每列字数都由它们决定）。切主题即应用新主题的完整版式，',
    '   * 残留补丁一律清空；持久化走常规落盘（本书作用域）。',
    '   */',
    '  function resetForThemeSwitch(): void {',
    '    tokenPatch.value = {};',
    '    features.value = {};',
    '    sourceDirty = true;',
    '    if (draftMode.value) beginDraft();',
    '    scheduleSave();',
    '  }',
  );
  if (!src.includes(a1)) throw new Error('s1');
  src = src.replace(a1, n1);

  // 导出（resetAll 附近）
  const a2 = '    resetAll,';
  if (!src.includes(a2)) throw new Error('s2');
  src = src.replace(a2, j('    resetForThemeSwitch,', '    resetAll,'));

  fs.writeFileSync(p, src, 'utf8');
  console.log('style-settings done');
}

// ============ 2. App.vue：切换主题前清残留 ============
{
  const p = 'apps/demo/src/App.vue';
  let src = fs.readFileSync(p, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const j = (...l) => l.join(EOL);

  // 包装函数（插在 switchTheme 解构之后——App 从 layout 解构 switchTheme？实际来自 reader session；
  // 在两个透传点换成 onSwitchTheme）
  const a1 = j(
    '  /**',
    '   * 「保存」走的是 `styleApi` 草稿、也不触碰 `themeKey`。漏存会导致下次进来主题回落',
  );
  if (!src.includes(a1)) throw new Error('a1 anchor');
  src = src.replace(a1, j(
    '  /**',
    '   * 顶栏 / 更多面板的主题切换入口：先清空上一主题残留的版式设置（令牌补丁',
    '   * 与功能样式，见 useStyleSettings.resetForThemeSwitch），再走主题切换流程——',
    '   * 版式度量令牌与书写方向强耦合，横排调的字号 / 行高 / 字距残留到直排会',
    '   * 破坏字位网格与界行对齐。',
    '   */',
    '  function onSwitchTheme(key: ThemeKey): void {',
    '    styleApi.resetForThemeSwitch();',
    '    switchTheme(key);',
    '  }',
    '',
  ) + a1);

  // 两个透传点换绑
  const old2 = ':switch-theme="switchTheme"';
  let count = 0;
  while (src.includes(old2)) {
    src = src.replace(old2, ':switch-theme="onSwitchTheme"');
    count += 1;
  }
  if (count < 2) throw new Error('expected >=2 passthrough sites, got ' + count);

  // ThemeKey 类型导入（onSwitchTheme 签名用）
  if (!src.includes("type ThemeKey")) {
    const a3 = "import { CLASSICAL_THEME_OVERRIDES }";
    if (src.includes("from '@bibliotype/layout';")) {
      // 找一个已存在的 @bibliotype/layout 导入行追加 type ThemeKey
      const m = src.match(/import \{([^}]+)\} from '@bibliotype\/layout';/);
      if (m === null) throw new Error('layout import');
      src = src.replace(m[0], m[0].replace('{', '{ type ThemeKey,'));
    }
  }

  fs.writeFileSync(p, src, 'utf8');
  console.log('App done, passthrough swapped: ' + count);
}
