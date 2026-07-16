import { describe, it, expect } from 'vitest';
import {
  nowJstIso,
  todayJst,
  addDays,
  isoToLocalInput,
  localInputToIso,
  newEnvelope,
  applyEdit,
  upsertByRid,
  groupActivityLogsByDate,
  recordTaskDoneDates,
  jstDateOf,
  validateRecord,
} from '../src/index';
import type { CbtRecord } from '../src/index';

function log(rid: string, at: string, mood: number | null = 50, transferred = false): CbtRecord {
  return {
    rid,
    type: 'activity_log',
    schema: 1,
    created: at,
    updated: at,
    transferred,
    data: { at, note: 'テスト', mood },
  };
}

describe('time', () => {
  it('nowJstIso は +09:00 付きISO 8601形式', () => {
    expect(nowJstIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it('UTC 15:00 → JST 翌日00:00(端末TZ非依存)', () => {
    const utc = new Date('2026-07-11T15:00:00Z');
    expect(nowJstIso(utc)).toBe('2026-07-12T00:00:00+09:00');
    expect(todayJst(utc)).toBe('2026-07-12');
  });

  it('addDays が月跨ぎ・年跨ぎを処理する', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('datetime-local との相互変換', () => {
    expect(isoToLocalInput('2026-07-16T21:30:00+09:00')).toBe('2026-07-16T21:30');
    expect(localInputToIso('2026-07-16T21:30')).toBe('2026-07-16T21:30:00+09:00');
  });
});

describe('applyEdit(§4.1 編集と再転送の規則)', () => {
  it('転送済みレコードの編集で transferred が false に戻る', () => {
    const r = log('01A', '2026-07-11T10:00:00+09:00', 40, true);
    const edited = applyEdit(r);
    expect(edited.transferred).toBe(false);
    expect(edited.updated > r.updated).toBe(true);
    expect(r.transferred).toBe(true); // 元オブジェクトは不変
  });
});

describe('upsertByRid(§4.1 治療者側upsert)', () => {
  it('rid一致は updated の新しい方を採用する', () => {
    const older = log('01A', '2026-07-11T10:00:00+09:00');
    const newer = { ...older, updated: '2026-07-11T12:00:00+09:00' };
    expect(upsertByRid([newer], [older])[0]!.updated).toBe(newer.updated);
    expect(upsertByRid([older], [newer])[0]!.updated).toBe(newer.updated);
  });

  it('rid不一致は追加される', () => {
    const a = log('01A', '2026-07-11T10:00:00+09:00');
    const b = log('01B', '2026-07-12T10:00:00+09:00');
    expect(upsertByRid([a], [b])).toHaveLength(2);
  });
});

describe('groupActivityLogsByDate(§4.2 ふりかえり表示)', () => {
  it('日ごとに束ね、日内は時刻順、日付は降順', () => {
    const records = [
      log('01A', '2026-07-15T21:00:00+09:00'),
      log('01B', '2026-07-16T08:00:00+09:00'),
      log('01C', '2026-07-16T22:30:00+09:00'),
      log('01D', '2026-07-16T12:00:00+09:00'),
    ];
    const grouped = groupActivityLogsByDate(records);
    expect([...grouped.keys()]).toEqual(['2026-07-16', '2026-07-15']);
    const day16 = grouped.get('2026-07-16')!;
    expect(day16.map((r) => r.rid)).toEqual(['01B', '01D', '01C']);
  });

  it('jstDateOf は at の日付部を返す', () => {
    expect(jstDateOf('2026-07-16T21:30:00+09:00')).toBe('2026-07-16');
  });
});

describe('recordTaskDoneDates(§4.4 record課題の自動判定)', () => {
  it('期間内に対象帳票の記録がある日を実施扱いにする', () => {
    const period = { start: '2026-07-13', end: '2026-07-19' };
    const records = [
      log('01A', '2026-07-14T09:00:00+09:00'),
      log('01B', '2026-07-14T21:00:00+09:00'), // 同日2件でも1日
      log('01C', '2026-07-16T12:00:00+09:00'),
      log('01D', '2026-07-12T12:00:00+09:00'), // 期間外
    ];
    const done = recordTaskDoneDates(records, 'activity_log', period);
    expect([...done].sort()).toEqual(['2026-07-14', '2026-07-16']);
  });

  it('three_column は created の日付で判定する', () => {
    const env = newEnvelope('three_column');
    const rec: CbtRecord = {
      ...env,
      created: '2026-07-15T10:00:00+09:00',
      type: 'three_column',
      data: { event: 'x', moods: [], thoughts: [] },
    };
    const done = recordTaskDoneDates([rec], 'three_column', {
      start: '2026-07-13',
      end: '2026-07-19',
    });
    expect(done.has('2026-07-15')).toBe(true);
  });
});

describe('validateRecord(v1.2)', () => {
  it('正常な活動記録はエラーなし', () => {
    const env = newEnvelope('activity_log');
    const r: CbtRecord = {
      ...env,
      type: 'activity_log',
      data: { at: '2026-07-16T21:30:00+09:00', note: '', mood: null },
    };
    expect(validateRecord(r)).toEqual([]);
  });

  it('atの形式不正・moodの値域逸脱を検出する', () => {
    const bad = log('01A', '2026-07-16 21:30');
    expect(validateRecord(bad).length).toBeGreaterThan(0);
    const bad2 = log('01B', '2026-07-16T21:30:00+09:00', 101);
    expect(validateRecord(bad2).length).toBeGreaterThan(0);
  });

  it('record課題の target_type 欠落・未知kindを検出する', () => {
    const env = newEnvelope('homework_week');
    const r: CbtRecord = {
      ...env,
      type: 'homework_week',
      data: {
        session_no: 1,
        period: { start: '2026-07-13', end: '2026-07-19' },
        tasks: [
          { no: 1, kind: 'record', content: '活動記録を毎日つける' }, // target_type欠落
          { no: 2, kind: 'oneshot', content: '散歩コースを決める', done: false },
          { no: 3, kind: 'daily', content: '朝にカーテンを開ける' },
        ],
        checks: {},
      },
    };
    const errors = validateRecord(r);
    expect(errors.some((e) => e.includes('target_type'))).toBe(true);
  });
});
