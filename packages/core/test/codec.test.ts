import { describe, it, expect } from 'vitest';
import {
  encodeToFrames,
  parseFrame,
  FrameCollector,
  crc32Hex,
  toBase64url,
  fromBase64url,
} from '../src/index';
import type { TransferPayload, CbtRecord } from '../src/index';

function makePayload(recordCount = 10): TransferPayload {
  const records: CbtRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    records.push({
      rid: `01J8X${String(i).padStart(21, '0')}`,
      type: 'activity_log',
      schema: 1,
      created: '2026-07-11T21:30:00+09:00',
      updated: '2026-07-11T21:35:00+09:00',
      transferred: false,
      data: {
        at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T${String(8 + (i % 14)).padStart(2, '0')}:30:00+09:00`,
        note: `なんとか起きてカーテンを開けた ${i}`,
        mood: i % 5 === 4 ? null : 20 + ((i * 13) % 60),
      },
    });
  }
  return { proto: 1, pid: 'P001', exported: '2026-07-18T10:02:00+09:00', records };
}

describe('base64url', () => {
  it('往復で一致する(各種長さ)', () => {
    for (const len of [0, 1, 2, 3, 4, 255, 1000, 70000]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 7 + 13) % 256;
      expect(fromBase64url(toBase64url(bytes))).toEqual(bytes);
    }
  });

  it('パディングなし・URL安全文字のみ', () => {
    const s = toBase64url(new Uint8Array([251, 255, 254, 62, 63]));
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe('crc32', () => {
  it('既知ベクトル: "123456789" → cbf43926', () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });
});

describe('encodeToFrames / parseFrame', () => {
  it('フレーム形式が仕様どおり(CBTX|1|sid|seq/total|crc32|chunk)', () => {
    const { frames, sid, stats } = encodeToFrames(makePayload(), { chunkSize: 450 });
    expect(frames.length).toBe(stats.frameCount);
    frames.forEach((f, i) => {
      const p = parseFrame(f);
      expect(p).not.toBeNull();
      expect(p!.sid).toBe(sid);
      expect(p!.seq).toBe(i + 1);
      expect(p!.total).toBe(frames.length);
      expect(p!.crc).toBe(stats.crc32);
      expect(p!.chunk.length).toBeLessThanOrEqual(450);
    });
  });

  it('チャンクサイズを下げるとフレーム数が増える', () => {
    const payload = makePayload(20);
    const a = encodeToFrames(payload, { chunkSize: 450 });
    const b = encodeToFrames(payload, { chunkSize: 300 });
    expect(b.stats.frameCount).toBeGreaterThan(a.stats.frameCount);
  });

  it('parseFrame は無関係な文字列を null にする', () => {
    expect(parseFrame('https://example.com')).toBeNull();
    expect(parseFrame('CBTX|2|ABCD|1/1|00000000|xx')).toBeNull(); // 未知プロト
    expect(parseFrame('CBTX|1|ABCD|0/1|00000000|xx')).toBeNull(); // seq範囲外
    expect(parseFrame('CBTX|1|ABCD|2/1|00000000|xx')).toBeNull(); // seq>total
    expect(parseFrame('CBTX|1|ABCD|1/1|zzzz0000|xx')).toBeNull(); // crc形式不正
  });
});

describe('FrameCollector', () => {
  it('順序どおりの収集で complete し、ペイロードが一致する', () => {
    const payload = makePayload(15);
    const { frames } = encodeToFrames(payload, { chunkSize: 300 });
    expect(frames.length).toBeGreaterThan(1);
    const c = new FrameCollector();
    let ev = c.addFrame(frames[0]!);
    for (let i = 1; i < frames.length; i++) {
      ev = c.addFrame(frames[i]!);
    }
    expect(ev.kind).toBe('complete');
    if (ev.kind === 'complete') {
      expect(ev.payload).toEqual(payload);
    }
  });

  it('順不同・重複フレームでも complete する(ループ再生の途中参加を模擬)', () => {
    const payload = makePayload(15);
    const { frames } = encodeToFrames(payload, { chunkSize: 300 });
    const c = new FrameCollector();
    // 3番目から読み始めてループ、重複あり
    const order = [...frames.slice(2), ...frames, ...frames.slice(0, 2)];
    let completed: TransferPayload | null = null;
    for (const f of order) {
      const ev = c.addFrame(f);
      if (ev.kind === 'complete') {
        completed = ev.payload;
        break;
      }
    }
    expect(completed).toEqual(payload);
  });

  it('progress が missing フレーム番号を報告する', () => {
    const { frames } = encodeToFrames(makePayload(15), { chunkSize: 300 });
    const c = new FrameCollector();
    const ev = c.addFrame(frames[1]!); // seq=2 のみ
    expect(ev.kind).toBe('progress');
    if (ev.kind === 'progress') {
      expect(ev.missing).not.toContain(2);
      expect(ev.missing).toContain(1);
    }
  });

  it('新しい sid が来たら乗り換える(古いセッションを破棄)', () => {
    const payload = makePayload(15);
    const a = encodeToFrames(payload, { chunkSize: 300, sid: 'AAAA' });
    const b = encodeToFrames(payload, { chunkSize: 300, sid: 'BBBB' });
    const c = new FrameCollector();
    c.addFrame(a.frames[0]!);
    c.addFrame(b.frames[0]!); // 乗り換え
    expect(c.currentSid).toBe('BBBB');
    let ev: ReturnType<FrameCollector['addFrame']> = { kind: 'ignored' };
    for (let i = 1; i < b.frames.length; i++) ev = c.addFrame(b.frames[i]!);
    expect(ev.kind).toBe('complete');
  });

  it('チャンク破損は crc_mismatch になり、リセットされる', () => {
    const payload = makePayload(15);
    const { frames } = encodeToFrames(payload, { chunkSize: 300, sid: 'CCCC' });
    const c = new FrameCollector();
    // 最終フレームのチャンク先頭を改ざん(Base64url的に有効な文字で置換)
    // ※末尾文字はBase64のパディングビットに当たり復元結果が変わらないことがあるため先頭を使う
    const last = frames[frames.length - 1]!;
    const chunkStart = last.lastIndexOf('|') + 1;
    const orig = last[chunkStart]!;
    const tampered =
      last.slice(0, chunkStart) + (orig === 'A' ? 'B' : 'A') + last.slice(chunkStart + 1);
    for (let i = 0; i < frames.length - 1; i++) c.addFrame(frames[i]!);
    const ev = c.addFrame(tampered);
    expect(ev.kind).toBe('error');
    if (ev.kind === 'error') expect(ev.reason).toBe('crc_mismatch');
    expect(c.currentSid).toBeNull(); // リセット済み → そのまま再読取できる
  });

  it('同一 sid で crc/total が食い違うフレームは無視する', () => {
    const { frames } = encodeToFrames(makePayload(15), { chunkSize: 300, sid: 'DDDD' });
    const c = new FrameCollector();
    c.addFrame(frames[0]!);
    const forged = `CBTX|1|DDDD|2/${frames.length}|deadbeef|xxxx`;
    expect(c.addFrame(forged).kind).toBe('ignored');
  });

  it('complete 後の同一 sid フレームは ignored(ループ再生継続を模擬)', () => {
    const { frames } = encodeToFrames(makePayload(15), { chunkSize: 300 });
    const c = new FrameCollector();
    let ev: ReturnType<FrameCollector['addFrame']> = { kind: 'ignored' };
    for (const f of frames) ev = c.addFrame(f);
    expect(ev.kind).toBe('complete');
    expect(c.addFrame(frames[0]!).kind).toBe('ignored');
  });

  it('total=1(静止QR1枚)でも動作する', () => {
    const payload = makePayload(1);
    const { frames } = encodeToFrames(payload, { chunkSize: 100000 });
    expect(frames.length).toBe(1);
    const c = new FrameCollector();
    const ev = c.addFrame(frames[0]!);
    expect(ev.kind).toBe('complete');
    if (ev.kind === 'complete') expect(ev.payload).toEqual(payload);
  });

  it('容量目安の確認: 週次データがフレーム数枚に収まる', () => {
    // 活動メモ7日+3コラム3場面+HW1件相当 ≒ レコード11件
    const { stats } = encodeToFrames(makePayload(11), { chunkSize: 450 });
    expect(stats.frameCount).toBeLessThanOrEqual(6);
  });
});
