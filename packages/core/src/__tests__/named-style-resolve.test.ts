/**
 * C10 命名样式继承链：合并顺序、断链 / 成环降级、结构校验与持久化保留
 */
import { describe, expect, it } from 'vitest';
import type { FeatureDeclarations, NamedStyle, NamedStyleSet } from '../theme/feature-style.js';
import {
  NAMED_STYLE_ISSUE_CODES,
  resolveNamedStyleChain,
  resolveNamedStyleDeclarations,
  validateNamedStyleSet,
} from '../theme/named-style-resolve.js';
import { normalizeStyleSnapshot } from '../settings/style-settings.js';

function style(
  id: string,
  declarations: FeatureDeclarations,
  basedOn?: string,
): NamedStyle {
  return {
    id,
    name: id,
    featureId: 'block.paragraph',
    ...(basedOn === undefined ? {} : { basedOn }),
    declarations,
  };
}

function set(styles: NamedStyle[]): NamedStyleSet {
  return { version: 1, styles };
}

describe('resolveNamedStyleDeclarations', () => {
  it('祖先在前、后代覆盖', () => {
    const styles = set([
      style('base', { color: 'red', 'font-size': '14px' }),
      style('child', { color: 'blue' }, 'base'),
    ]);
    expect(resolveNamedStyleDeclarations(styles, 'child')).toEqual({
      color: 'blue',
      'font-size': '14px',
    });
  });

  it('多级继承按链合并', () => {
    const styles = set([
      style('a', { color: 'red' }),
      style('b', { color: 'green', 'font-weight': '600' }, 'a'),
      style('c', { 'font-style': 'italic' }, 'b'),
    ]);
    expect(resolveNamedStyleDeclarations(styles, 'c')).toEqual({
      color: 'green',
      'font-weight': '600',
      'font-style': 'italic',
    });
  });

  it('只写依据、自身声明为空的样式仍能继承', () => {
    const styles = set([style('base', { color: 'red' }), style('child', {}, 'base')]);
    expect(resolveNamedStyleDeclarations(styles, 'child')).toEqual({ color: 'red' });
  });

  it('断链时返回已收集部分且不抛异常', () => {
    const styles = set([style('child', { color: 'blue' }, 'missing')]);
    expect(resolveNamedStyleDeclarations(styles, 'child')).toEqual({ color: 'blue' });
  });

  it('成环时终止且不抛异常', () => {
    const styles = set([
      style('a', { color: 'red' }, 'b'),
      style('b', { 'font-size': '12px' }, 'a'),
    ]);
    expect(() => resolveNamedStyleDeclarations(styles, 'a')).not.toThrow();
    expect(resolveNamedStyleDeclarations(styles, 'a')).toEqual({
      'font-size': '12px',
      color: 'red',
    });
  });

  it('不存在的样式 id 返回空声明', () => {
    expect(resolveNamedStyleDeclarations(set([]), 'nope')).toEqual({});
  });

  it('继承链根 → 叶顺序供 UI 展示', () => {
    const styles = set([
      style('a', {}),
      style('b', {}, 'a'),
      style('c', {}, 'b'),
    ]);
    expect(resolveNamedStyleChain(styles, 'c').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('validateNamedStyleSet', () => {
  it('合法集合无问题', () => {
    expect(validateNamedStyleSet(set([style('a', {}), style('b', {}, 'a')]))).toEqual([]);
  });

  it('重复 id', () => {
    const issues = validateNamedStyleSet(set([style('a', {}), style('a', {})]));
    expect(issues.some((issue) => issue.code === NAMED_STYLE_ISSUE_CODES.DUPLICATE_ID)).toBe(true);
  });

  it('自引用', () => {
    const issues = validateNamedStyleSet(set([style('a', {}, 'a')]));
    expect(issues.some((issue) => issue.code === NAMED_STYLE_ISSUE_CODES.SELF_REFERENCE)).toBe(true);
  });

  it('缺失依据', () => {
    const issues = validateNamedStyleSet(set([style('a', {}, 'missing')]));
    expect(issues.some((issue) => issue.code === NAMED_STYLE_ISSUE_CODES.MISSING_BASED_ON)).toBe(
      true,
    );
  });

  it('继承环', () => {
    const issues = validateNamedStyleSet(
      set([style('a', {}, 'b'), style('b', {}, 'a')]),
    );
    expect(issues.some((issue) => issue.code === NAMED_STYLE_ISSUE_CODES.CIRCULAR_BASED_ON)).toBe(
      true,
    );
  });
});

describe('normalizeStyleSnapshot 保留 basedOn', () => {
  it('往返保留合法依据', () => {
    const snapshot = normalizeStyleSnapshot(
      {
        namedStyles: {
          version: 1,
          styles: [
            { id: 'a', name: 'A', featureId: 'block.paragraph', declarations: { color: 'red' } },
            {
              id: 'b',
              name: 'B',
              featureId: 'block.paragraph',
              basedOn: 'a',
              declarations: {},
            },
          ],
        },
      },
      'global',
    );
    expect(snapshot.namedStyles.styles[1]?.basedOn).toBe('a');
  });

  it('自引用被丢弃', () => {
    const snapshot = normalizeStyleSnapshot(
      {
        namedStyles: {
          version: 1,
          styles: [
            {
              id: 'a',
              name: 'A',
              featureId: 'block.paragraph',
              basedOn: 'a',
              declarations: {},
            },
          ],
        },
      },
      'global',
    );
    expect(snapshot.namedStyles.styles[0]?.basedOn).toBeUndefined();
  });
});
