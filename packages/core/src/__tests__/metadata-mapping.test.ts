/**
 * 典籍元数据测试（K7）
 *
 * 覆盖：四部/版本/藏地/索书号校验（含非法值拦截）、DC 映射字段完整性、
 * 序列化确定性、CNMARC 字段行、旧 extra 迁移与幂等。
 */
import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '../ir/metadata.js';
import {
  serializeDublinCore,
  toCnmarc,
  toDublinCore,
} from '../metadata-mapping.js';
import { migrateLegacyMetadata } from '../metadata-migration.js';
import { validateMetadata } from '../metadata-validation.js';

/** 一本完整的古籍元数据 */
function sample(): BookMetadata {
  return {
    title: '论语',
    subtitle: '十卷',
    contributors: [
      { name: '孔子', dynasty: '春秋', role: '撰' },
      { name: '朱熹', dynasty: '宋', role: '注' },
    ],
    edition: { name: '庚辰本', era: '清乾隆五十六年', kind: 'base' },
    editionType: 'block-print',
    volumeCount: 20,
    classification: 'B222.2',
    classicalCategory: { division: 'jing', subdivision: '四书类' },
    repository: '中国国家图书馆',
    callNumber: '善本 123',
    language: 'zh-Hant',
    identifiers: [{ scheme: 'isbn', value: '978-7-101-00001-1' }],
    publication: { publisher: '中华书局', year: '1980', place: '北京' },
  };
}

describe('validateMetadata', () => {
  it('完整元数据无问题', () => {
    expect(validateMetadata(sample())).toEqual([]);
  });

  it('非法四部 / 版本类型 / 卷数 / 空书名被拦截', () => {
    const issues = validateMetadata({
      title: '',
      volumeCount: 0,
      classicalCategory: { division: 'foo' as never },
      editionType: 'stone' as never,
      repository: '   ',
      language: 'zh Hans',
    });
    const fields = issues.map((issue) => issue.field);
    expect(fields).toContain('title');
    expect(fields).toContain('volumeCount');
    expect(fields).toContain('classicalCategory.division');
    expect(fields).toContain('editionType');
    expect(fields).toContain('repository');
    expect(fields).toContain('language');
    // 中文说明可直接展示
    expect(issues.find((issue) => issue.field === 'volumeCount')?.message).toContain('正整数');
  });
});

describe('toDublinCore', () => {
  it('关键字段无丢失', () => {
    const record = toDublinCore(sample());
    expect(record.title).toBe('论语');
    expect(record.creator).toEqual(['孔子']);
    expect(record.contributor).toEqual(['朱熹']);
    expect(record.type).toBe('Text');
    expect(record.publisher).toBe('中华书局');
    expect(record.date).toBe('1980');
    expect(record.language).toBe('zh-Hant');
    expect(record.identifier).toEqual(['isbn:978-7-101-00001-1']);
    expect(record.subject).toEqual(['经部', '四书类', 'B222.2']);
    expect(record.source).toContain('庚辰本');
    expect(record.relation).toEqual(['底本']);
    expect(record.description).toBe('20 卷');
  });

  it('责任者按角色分流：注者进 contributor', () => {
    const record = toDublinCore({
      title: '论语',
      contributors: [
        { name: '孔子', role: '撰' },
        { name: '郑玄', role: '注' },
      ],
    });
    expect(record.creator).toEqual(['孔子']);
    expect(record.contributor).toEqual(['郑玄']);
    expect(record.identifier).toEqual([]);
    expect(record.subject).toEqual([]);
  });

  it('序列化逐字节一致（键序固定）', () => {
    const first = serializeDublinCore(toDublinCore(sample()));
    const second = serializeDublinCore(toDublinCore(sample()));
    expect(first).toBe(second);
    expect(first.indexOf('"title"')).toBeLessThan(first.indexOf('"creator"'));
  });
});

describe('toCnmarc', () => {
  it('输出关键字段行且空字段省略', () => {
    const text = toCnmarc(sample());
    expect(text).toContain('200 1#$a论语$e十卷$f孔子 撰；朱熹 注');
    expect(text).toContain('205 ##$a刻本 庚辰本$f清乾隆五十六年');
    expect(text).toContain('210 ##$a北京$c中华书局$d1980');
    expect(text).toContain('215 ##$a20 卷');
    expect(text).toContain('300 ##$a藏地：中国国家图书馆；索书号：善本 123');
    expect(text).toContain('690 ##$a经部$h四书类');
    expect(text).toContain('905 ##$a中国国家图书馆$b善本 123');
    expect(text).toContain('801 #0$aCN');
    // 001 取编目号 / ISBN
    expect(text.startsWith('001  978-7-101-00001-1')).toBe(true);
    // 每行一个字段，无末尾空行
    expect(text.endsWith('\n')).toBe(false);
  });

  it('缺字段时不编造内容', () => {
    const text = toCnmarc({ title: '论语' });
    expect(text).not.toContain('010');
    expect(text).not.toContain('210');
    expect(text).toContain('200 1#$a论语');
    expect(text).toContain('001  bt-');
  });

  it('子字段值中的 $ 与换行被清洗', () => {
    const text = toCnmarc({ title: '论语$上\n下' });
    expect(text).not.toContain('$a论语$上');
    expect(text).toContain('论语＄上 下');
  });
});

describe('migrateLegacyMetadata', () => {
  it('把 extra 中的古籍字段提升到顶层', () => {
    const original: BookMetadata = {
      title: '论语',
      extra: {
        repository: '中国国家图书馆',
        callNumber: '善本 123',
        editionType: 'manuscript',
        classicalCategory: { division: 'shi', subdivision: '正史类' },
        other: '保留',
      },
    };
    const migrated = migrateLegacyMetadata(original);
    expect(migrated.repository).toBe('中国国家图书馆');
    expect(migrated.callNumber).toBe('善本 123');
    expect(migrated.editionType).toBe('manuscript');
    expect(migrated.classicalCategory).toEqual({ division: 'shi', subdivision: '正史类' });
    expect(migrated.extra).toEqual({ other: '保留' });
    // 原对象不被修改
    expect(original.repository).toBeUndefined();
    expect(original.extra).toHaveProperty('repository');
  });

  it('顶层优先，迁移后清空 extra', () => {
    const migrated = migrateLegacyMetadata({
      title: '论语',
      repository: '私人藏',
      extra: { repository: '国图', callNumber: 'A1' },
    });
    expect(migrated.repository).toBe('私人藏');
    expect(migrated.callNumber).toBe('A1');
    expect(migrated.extra).toBeUndefined();
  });

  it('幂等：重复迁移结果一致', () => {
    const once = migrateLegacyMetadata({ title: '论语', extra: { repository: '国图' } });
    const twice = migrateLegacyMetadata(once);
    expect(twice).toEqual(once);
  });

  it('无 extra 时原样返回', () => {
    const metadata: BookMetadata = { title: '论语' };
    expect(migrateLegacyMetadata(metadata)).toBe(metadata);
  });
});
