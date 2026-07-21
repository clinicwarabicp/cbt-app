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
  latestDayLabelByDate,
  migrateRecord,
  jstDateOf,
  clinicalDateOf,
  slotIndexOf,
  slotStartHour,
  slotStartIso,
  slotCount,
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

describe('clinicalDateOf(v1.3 §4.2: 1日の区切り=午前4時)', () => {
  it('0:00〜3:59は前日に帰属、4:00からは当日', () => {
    expect(clinicalDateOf('2026-07-16T03:59:00+09:00')).toBe('2026-07-15');
    expect(clinicalDateOf('2026-07-16T04:00:00+09:00')).toBe('2026-07-16');
    expect(clinicalDateOf('2026-07-16T00:00:00+09:00')).toBe('2026-07-15');
    expect(clinicalDateOf('2026-07-16T23:59:00+09:00')).toBe('2026-07-16');
  });

  it('月初の深夜は前月末日に帰属する', () => {
    expect(clinicalDateOf('2026-08-01T01:00:00+09:00')).toBe('2026-07-31');
  });

  it('jstDateOf(実日付)は従来どおり', () => {
    expect(jstDateOf('2026-07-16T21:30:00+09:00')).toBe('2026-07-16');
  });
});

describe('時間帯マス(v1.3 §4.2: 4時始まり)', () => {
  it('1時間刻み: 4時台=マス0、23時台=マス19、0時台=マス20、3時台=マス23', () => {
    expect(slotCount(1)).toBe(24);
    expect(slotIndexOf('2026-07-16T04:10:00+09:00', 1)).toBe(0);
    expect(slotIndexOf('2026-07-16T23:59:00+09:00', 1)).toBe(19);
    expect(slotIndexOf('2026-07-17T00:30:00+09:00', 1)).toBe(20);
    expect(slotIndexOf('2026-07-17T03:59:00+09:00', 1)).toBe(23);
  });

  it('2時間刻みへも定数変更のみで対応(粒度の将来変更)', () => {
    expect(slotCount(2)).toBe(12);
    expect(slotIndexOf('2026-07-16T04:10:00+09:00', 2)).toBe(0);
    expect(slotIndexOf('2026-07-16T05:59:00+09:00', 2)).toBe(0);
    expect(slotIndexOf('2026-07-17T03:59:00+09:00', 2)).toBe(11);
  });

  it('slotStartIso: 深夜マスは実日付が翌日になる(保存は実時刻のまま)', () => {
    expect(slotStartHour(0, 1)).toBe(4);
    expect(slotStartHour(20, 1)).toBe(0);
    expect(slotStartIso('2026-07-16', 0, 1)).toBe('2026-07-16T04:00:00+09:00');
    expect(slotStartIso('2026-07-16', 20, 1)).toBe('2026-07-17T00:00:00+09:00');
    // 往復: マス開始時刻は同じ臨床日・同じマスに戻る
    expect(clinicalDateOf(slotStartIso('2026-07-16', 20, 1))).toBe('2026-07-16');
    expect(slotIndexOf(slotStartIso('2026-07-16', 20, 1), 1)).toBe(20);
  });
});

describe('groupActivityLogsByDate(§4.2 ふりかえり表示・4時区切り)', () => {
  it('日ごとに束ね、日内は時刻順、日付は降順。深夜帯は前日に入る', () => {
    const records = [
      log('01A', '2026-07-15T21:00:00+09:00'),
      log('01B', '2026-07-16T08:00:00+09:00'),
      log('01C', '2026-07-16T22:30:00+09:00'),
      log('01D', '2026-07-16T12:00:00+09:00'),
      log('01E', '2026-07-17T01:30:00+09:00'), // 深夜 → 16日に帰属
    ];
    const grouped = groupActivityLogsByDate(records);
    expect([...grouped.keys()]).toEqual(['2026-07-16', '2026-07-15']);
    const day16 = grouped.get('2026-07-16')!;
    expect(day16.map((r) => r.rid)).toEqual(['01B', '01D', '01C', '01E']);
  });
});

describe('latestDayLabelByDate(v1.3 §4.2 日ラベル)', () => {
  it('同一dateは updated 最新のみ', () => {
    const mk = (rid: string, date: string, label: string, updated: string): CbtRecord => ({
      rid,
      type: 'day_label',
      schema: 1,
      created: updated,
      updated,
      transferred: false,
      data: { date, label },
    });
    const map = latestDayLabelByDate([
      mk('01A', '2026-07-16', '仕事', '2026-07-16T09:00:00+09:00'),
      mk('01B', '2026-07-16', '休み', '2026-07-16T21:00:00+09:00'),
      mk('01C', '2026-07-15', '通院', '2026-07-15T10:00:00+09:00'),
    ]);
    expect(map.get('2026-07-16')!.rid).toBe('01B');
    expect(map.size).toBe(2);
  });
});

describe('migrateRecord(v1.3 移行処理)', () => {
  it('three_column → column(rid・updated・transferred維持)', () => {
    const old = {
      rid: '01A',
      type: 'three_column',
      schema: 1,
      created: '2026-07-15T10:00:00+09:00',
      updated: '2026-07-15T10:00:00+09:00',
      transferred: true,
      data: { event: 'x', moods: [{ label: '不安', intensity: 60 }], thoughts: [] },
    } as unknown as CbtRecord;
    const migrated = migrateRecord(old);
    expect(migrated.type).toBe('column');
    expect(migrated.rid).toBe('01A');
    expect(migrated.transferred).toBe(true);
    expect(migrated.updated).toBe(old.updated);
  });

  it('HW課題の target_type も three_column → column', () => {
    const hw = {
      ...newEnvelope('homework_week'),
      type: 'homework_week',
      data: {
        session_no: 1,
        period: { start: '2026-07-13', end: '2026-07-19' },
        tasks: [
          { no: 1, kind: 'record', content: 'コラム2場面', target_type: 'three_column' },
          { no: 2, kind: 'daily', content: '散歩' },
        ],
        checks: {},
      },
    } as unknown as CbtRecord;
    const migrated = migrateRecord(hw);
    if (migrated.type !== 'homework_week') throw new Error('unexpected');
    expect(migrated.data.tasks[0]!.target_type).toBe('column');
  });

  it('移行不要なレコードは同一オブジェクトを返す', () => {
    const l = log('01A', '2026-07-16T10:00:00+09:00');
    expect(migrateRecord(l)).toBe(l);
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

  it('column は created の日付(臨床日)で判定する', () => {
    const env = newEnvelope('column');
    const rec: CbtRecord = {
      ...env,
      created: '2026-07-16T01:30:00+09:00', // 深夜1時半 → 前日15日に帰属
      type: 'column',
      data: { event: 'x', moods: [], thoughts: [] },
    };
    const done = recordTaskDoneDates([rec], 'column', {
      start: '2026-07-13',
      end: '2026-07-19',
    });
    expect(done.has('2026-07-15')).toBe(true);
    expect(done.has('2026-07-16')).toBe(false);
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

  it('column型: 列4-7の値域も検証する(全列任意)', () => {
    const env = newEnvelope('column');
    const ok: CbtRecord = {
      ...env,
      type: 'column',
      data: {
        event: '会議で否定された',
        moods: [{ label: '不安', intensity: 60 }],
        thoughts: [{ text: '自分はダメだ', belief: 80 }],
        evidence: '上司は語気が強かった',
        counter: '同僚は後でフォローしてくれた',
        reframe: [{ text: '一つの意見が否定されただけだ', belief: 55 }],
        moods_after: [{ label: '不安', intensity: 40 }],
      },
    };
    expect(validateRecord(ok)).toEqual([]);
    const bad: CbtRecord = {
      ...ok,
      data: { ...ok.data, reframe: [{ text: 'x', belief: 105 }] },
    } as CbtRecord;
    expect(validateRecord(bad).length).toBeGreaterThan(0);
  });

  it('day_label: 日付形式と空ラベルを検証する', () => {
    const env = newEnvelope('day_label');
    const ok: CbtRecord = { ...env, type: 'day_label', data: { date: '2026-07-16', label: '仕事' } };
    expect(validateRecord(ok)).toEqual([]);
    const bad: CbtRecord = { ...env, type: 'day_label', data: { date: '2026-07-16', label: '  ' } };
    expect(validateRecord(bad).length).toBeGreaterThan(0);
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
