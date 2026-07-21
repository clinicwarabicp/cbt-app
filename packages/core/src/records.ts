// レコード操作の共通ルール(仕様書 §4.1・§4.2)

import { ulid } from 'ulid';
import { clinicalDateOf, nowJstIso } from './time';
import type { CbtRecord, RecordType } from './types';

/** レコードID(ULID)を生成 */
export function newRid(): string {
  return ulid();
}

/** 新規レコードのエンベロープを作る */
export function newEnvelope(type: RecordType): {
  rid: string;
  type: RecordType;
  schema: number;
  created: string;
  updated: string;
  transferred: boolean;
} {
  const now = nowJstIso();
  return { rid: newRid(), type, schema: 1, created: now, updated: now, transferred: false };
}

/**
 * §4.1 編集と再転送の規則(患者側):
 * 編集時は updated を更新し、transferred=true だった場合は false に戻す
 * (次回転送の対象に復帰させる)。新しいオブジェクトを返す。
 */
export function applyEdit<T extends CbtRecord>(record: T): T {
  return { ...record, updated: nowJstIso(), transferred: false };
}

/** updated の新しい方を返す(同値なら a) */
export function newerOf<T extends CbtRecord>(a: T, b: T): T {
  return b.updated > a.updated ? b : a;
}

/**
 * §4.1 治療者側upsert / §4.2 同一date重複解決にも使う:
 * rid一致は updated が新しい方を採用してマージした配列を返す
 */
export function upsertByRid(existing: CbtRecord[], incoming: CbtRecord[]): CbtRecord[] {
  const map = new Map<string, CbtRecord>();
  for (const r of existing) map.set(r.rid, r);
  for (const r of incoming) {
    const cur = map.get(r.rid);
    map.set(r.rid, cur ? newerOf(cur, r) : r);
  }
  return [...map.values()];
}

/** ISO 8601(+09:00)文字列からJST日付部("YYYY-MM-DD")を取り出す */
export function jstDateOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * §4.2 ふりかえり表示: 活動記録を日(臨床日=午前4時区切り)ごとに束ね、
 * 日内はatの時刻順に並べる。返り値のMapは日付降順(新しい日が先)。
 */
export function groupActivityLogsByDate(records: CbtRecord[]): Map<string, CbtRecord[]> {
  const byDate = new Map<string, CbtRecord[]>();
  for (const r of records) {
    if (r.type !== 'activity_log') continue;
    const date = clinicalDateOf(r.data.at);
    const list = byDate.get(date);
    if (list) list.push(r);
    else byDate.set(date, [r]);
  }
  const sorted = new Map(
    [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)),
  );
  for (const list of sorted.values()) {
    list.sort((a, b) =>
      (a.type === 'activity_log' ? a.data.at : '') < (b.type === 'activity_log' ? b.data.at : '')
        ? -1
        : 1,
    );
  }
  return sorted;
}

/**
 * §4.4 record課題の自動実施判定: 期間内の各日(臨床日=午前4時区切り)について、
 * target_type のレコードがその日に存在するかを返す。
 * 判定に使う日付は activity_log は data.at、その他は created を用いる。
 */
export function recordTaskDoneDates(
  records: CbtRecord[],
  targetType: RecordType,
  period: { start: string; end: string },
): Set<string> {
  const done = new Set<string>();
  for (const r of records) {
    if (r.type !== targetType) continue;
    const date = r.type === 'activity_log' ? clinicalDateOf(r.data.at) : clinicalDateOf(r.created);
    if (period.start <= date && date <= period.end) done.add(date);
  }
  return done;
}

/**
 * §4.2 日ラベル: 1日1つ。同一dateが複数あれば updated 最新を採用
 * (旧レコードは非表示だが削除しない)
 */
export function latestDayLabelByDate(records: CbtRecord[]): Map<string, CbtRecord> {
  const map = new Map<string, CbtRecord>();
  for (const r of records) {
    if (r.type !== 'day_label') continue;
    const cur = map.get(r.data.date);
    map.set(r.data.date, cur ? newerOf(cur, r) : r);
  }
  return map;
}

/**
 * v1.3 移行処理: 旧 `three_column` → `column`(rid・updated・transferredは維持)、
 * HW課題の target_type 'three_column' → 'column'。
 * 変更が不要なら同一オブジェクトをそのまま返す(参照比較で移行要否を判定できる)。
 */
export function migrateRecord(record: CbtRecord): CbtRecord {
  const rawType = (record as unknown as { type: string }).type;
  if (rawType === 'three_column') {
    return { ...(record as object), type: 'column' } as CbtRecord;
  }
  if (record.type === 'homework_week') {
    const needs = record.data.tasks.some(
      (t) => (t.target_type as string) === 'three_column',
    );
    if (needs) {
      return {
        ...record,
        data: {
          ...record.data,
          tasks: record.data.tasks.map((t) =>
            (t.target_type as string) === 'three_column'
              ? { ...t, target_type: 'column' as RecordType }
              : t,
          ),
        },
      };
    }
  }
  return record;
}

/** mood / intensity / belief の値域チェック(0–100の整数 or null) */
export function isValidMood(v: number | null): boolean {
  return v === null || (Number.isInteger(v) && v >= 0 && v <= 100);
}

/** 軽量バリデーション。問題があればメッセージ配列を返す(空=OK) */
export function validateRecord(record: CbtRecord): string[] {
  const errors: string[] = [];
  if (!record.rid) errors.push('rid がありません');
  if (record.schema !== 1) errors.push(`未知のschema版数: ${record.schema}`);
  switch (record.type) {
    case 'activity_log': {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(record.data.at)) {
        errors.push('at の形式が不正です(ISO 8601 +09:00)');
      }
      if (!isValidMood(record.data.mood)) errors.push('mood は0〜100の整数またはnullです');
      break;
    }
    case 'column': {
      if (!record.data.event.trim()) errors.push('出来事が未入力です');
      for (const m of record.data.moods) {
        if (!isValidMood(m.intensity)) errors.push('気分の強さは0〜100の整数です');
      }
      for (const t of record.data.thoughts) {
        if (!isValidMood(t.belief)) errors.push('確信度は0〜100の整数です');
      }
      for (const t of record.data.reframe ?? []) {
        if (!isValidMood(t.belief)) errors.push('新しい考え方の確信度は0〜100の整数です');
      }
      for (const m of record.data.moods_after ?? []) {
        if (!isValidMood(m.intensity)) errors.push('気分の再評価は0〜100の整数です');
      }
      break;
    }
    case 'day_label': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record.data.date)) errors.push('date の形式が不正です');
      if (!record.data.label.trim()) errors.push('ラベルが未入力です');
      break;
    }
    case 'homework_week': {
      const { period, tasks } = record.data;
      if (period.start > period.end) errors.push('期間の開始が終了より後になっています');
      if (tasks.length > 5) errors.push('課題は5件までです');
      const nos = new Set(tasks.map((t) => t.no));
      if (nos.size !== tasks.length) errors.push('課題番号が重複しています');
      for (const t of tasks) {
        if (!['record', 'oneshot', 'daily'].includes(t.kind)) {
          errors.push(`課題${t.no}: 未知の種別 ${String(t.kind)}`);
        }
        if (t.kind === 'record' && !t.target_type) {
          errors.push(`課題${t.no}: record課題には対象帳票(target_type)が必要です`);
        }
      }
      break;
    }
  }
  return errors;
}
