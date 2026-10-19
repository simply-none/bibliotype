/**
 * 表格尺寸选择器测试
 *
 * - 网格悬停 / 点击 → 发射 select（行列）；
 * - 精确输入越界时夹紧到 1~max；
 * - Esc / 外部点击关闭；点触发器不关闭（交父级切换）；
 * - Teleport 到 body，不受工具条 overflow 裁剪。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import BtTableSizePicker from '../components/BtTableSizePicker.vue';

const ANCHOR = { top: 200, left: 200, width: 40, height: 24 };

function mountPicker(props: Record<string, unknown> = {}): VueWrapper {
  return mount(BtTableSizePicker, {
    props: { anchor: ANCHOR, ...props },
    attachTo: document.body,
  });
}

function cell(rows: number, cols: number): HTMLButtonElement {
  const el = document.body.querySelector(
    `.bt-table-picker__cell[aria-label="${rows} 行 ${cols} 列"]`,
  );
  if (el === null) {
    throw new Error(`未找到 ${rows}×${cols} 单元格`);
  }
  return el as HTMLButtonElement;
}

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('BtTableSizePicker', () => {
  it('点击网格单元格发射 select（行 × 列）', async () => {
    wrapper = mountPicker();
    await nextTick();

    cell(2, 3).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('select')?.[0]).toEqual([{ rows: 2, cols: 3 }]);
  });

  it('精确输入越界时夹紧到 1~max 后发射', async () => {
    wrapper = mountPicker({ maxRows: 8, maxCols: 8 });
    await nextTick();

    const inputs = document.body.querySelectorAll<HTMLInputElement>(
      '.bt-table-picker__field input',
    );
    expect(inputs).toHaveLength(2);
    inputs[0]!.value = '99';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = '0';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const submit = document.body.querySelector('.bt-table-picker__submit') as HTMLButtonElement;
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('select')?.[0]).toEqual([{ rows: 8, cols: 1 }]);
  });

  it('Esc 关闭', async () => {
    wrapper = mountPicker();
    await nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('外部点击关闭，点触发器不关闭', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    wrapper = mountPicker({ trigger });
    await nextTick();

    // 点触发器：交给父级切换，选择器不关闭
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toBeUndefined();

    // 点页面其它位置：关闭
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
