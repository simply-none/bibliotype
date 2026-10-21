import { describe, expect, it } from 'vitest';
import {
  COLLAB_MAX_FRAME_BYTES,
  COLLAB_PROTOCOL_ERRORS,
  COLLAB_PROTOCOL_VERSION,
  decodeUpdate,
  encodeClientFrame,
  encodeServerFrame,
  encodeUpdate,
  parseClientFrame,
  parseServerFrame,
} from '../protocol.js';

describe('协同协议帧', () => {
  it('客户端帧往返：join / update / ping', () => {
    const join = parseClientFrame(
      encodeClientFrame({
        t: 'join',
        protocol: COLLAB_PROTOCOL_VERSION,
        docId: 'lunyu',
        clientId: 'c1',
      }),
    );
    expect(join.ok).toBe(true);
    if (join.ok && join.frame.t === 'join') {
      expect(join.frame.docId).toBe('lunyu');
    }

    const bytes = new Uint8Array([1, 2, 3, 250]);
    const update = parseClientFrame(
      encodeClientFrame({ t: 'update', update: encodeUpdate(bytes) }),
    );
    expect(update.ok).toBe(true);
    if (update.ok && update.frame.t === 'update') {
      expect([...decodeUpdate(update.frame.update)]).toEqual([1, 2, 3, 250]);
    }

    const ping = parseClientFrame(encodeClientFrame({ t: 'ping', at: 123 }));
    expect(ping.ok).toBe(true);
  });

  it('服务端帧往返：joined / sync / pong / error', () => {
    const joined = parseServerFrame(
      encodeServerFrame({
        t: 'joined',
        protocol: COLLAB_PROTOCOL_VERSION,
        clientId: 'srv-1',
      }),
    );
    expect(joined.ok).toBe(true);

    const sync = parseServerFrame(
      encodeServerFrame({ t: 'sync', update: encodeUpdate(new Uint8Array([9])) }),
    );
    expect(sync.ok).toBe(true);

    const pong = parseServerFrame(encodeServerFrame({ t: 'pong', at: 456 }));
    expect(pong.ok).toBe(true);

    const error = parseServerFrame(
      encodeServerFrame({
        t: 'error',
        code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
        message: '坏了',
      }),
    );
    expect(error.ok).toBe(true);
  });

  it('非法 JSON / 未知类型 / 缺字段一律拒绝', () => {
    expect(parseServerFrame('not-json').ok).toBe(false);
    expect(parseServerFrame('').ok).toBe(false);
    expect(parseServerFrame('[]').ok).toBe(false);
    expect(parseServerFrame(JSON.stringify({ t: 'what' })).ok).toBe(false);
    expect(parseServerFrame(JSON.stringify({ t: 'joined' })).ok).toBe(false);
    expect(parseServerFrame(JSON.stringify({ t: 'update', update: 1 })).ok).toBe(false);
    expect(parseServerFrame(JSON.stringify({ t: 'update', update: '***' })).ok).toBe(false);
    const bad = parseServerFrame(JSON.stringify({ t: 'update', update: 1 }));
    expect(bad.ok === false && bad.code).toBe(COLLAB_PROTOCOL_ERRORS.BAD_FRAME);
  });

  it('版本不匹配给出 PROTOCOL_MISMATCH', () => {
    const server = parseServerFrame(
      JSON.stringify({ t: 'joined', protocol: COLLAB_PROTOCOL_VERSION + 1, clientId: 'x' }),
    );
    expect(server.ok).toBe(false);
    expect(server.ok === false && server.code).toBe(COLLAB_PROTOCOL_ERRORS.PROTOCOL_MISMATCH);

    const client = parseClientFrame(
      JSON.stringify({
        t: 'join',
        protocol: COLLAB_PROTOCOL_VERSION + 1,
        docId: 'd',
        clientId: 'c',
      }),
    );
    expect(client.ok).toBe(false);
    expect(client.ok === false && client.code).toBe(COLLAB_PROTOCOL_ERRORS.PROTOCOL_MISMATCH);
  });

  it('帧上限是 8 MiB（常量对外可读）', () => {
    expect(COLLAB_MAX_FRAME_BYTES).toBe(8 * 1024 * 1024);
  });
});
