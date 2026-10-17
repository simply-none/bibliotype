/**
 * 书名清洗测试（导入侧元数据卫生）
 */
import { describe, expect, it } from 'vitest';
import { sanitizeBookTitle, titleFromFilename } from '../title.js';

describe('sanitizeBookTitle', () => {
  it('剥 z-library 系站点尾巴（括号 + 逗号并列多站点）', () => {
    expect(
      sanitizeBookTitle('诗经 (全二册) (中华经典名著全本全注全译丛书) (王秀梅 译注) (z-library.sk, 1lib.sk, z-lib.sk)'),
    ).toBe('诗经 (全二册) (中华经典名著全本全注全译丛书) (王秀梅 译注)');
    expect(sanitizeBookTitle('论语 (z-lib.sk)')).toBe('论语');
    expect(sanitizeBookTitle('论语 (1lib.sk)')).toBe('论语');
  });

  it('大小写不敏感；尾部/中部出现均可剥', () => {
    expect(sanitizeBookTitle('论语 (Z-Library.sk)')).toBe('论语');
    expect(sanitizeBookTitle('(z-library.sk) 论语')).toBe('论语');
  });

  it('无站点尾巴时仅折叠空白（正常书名不动）', () => {
    expect(sanitizeBookTitle('  论语  集注  ')).toBe('论语 集注');
    expect(sanitizeBookTitle('诗经（全二册）')).toBe('诗经（全二册）');
    expect(sanitizeBookTitle('红楼梦 ( 套装上下册 )')).toBe('红楼梦 ( 套装上下册 )');
  });

  it('幂等', () => {
    const once = sanitizeBookTitle('诗经 (z-library.sk, 1lib.sk)');
    expect(sanitizeBookTitle(once)).toBe(once);
  });

  it('非站点括号内容保留（避免误伤）', () => {
    expect(sanitizeBookTitle('论语 (中华经典名著)')).toBe('论语 (中华经典名著)');
    expect(sanitizeBookTitle('书 (z-library, 非站点词)')).toBe('书 (z-library, 非站点词)');
  });
});

describe('titleFromFilename', () => {
  it('去扩展名 + 清洗站点尾巴', () => {
    expect(
      titleFromFilename('诗经 (全二册) (z-library.sk, 1lib.sk, z-lib.sk).epub'),
    ).toBe('诗经 (全二册)');
    expect(titleFromFilename('论语.epub')).toBe('论语');
    expect(titleFromFilename('无扩展名')).toBe('无扩展名');
  });
});
