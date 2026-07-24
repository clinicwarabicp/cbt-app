// 患者側 IndexedDB層(仕様書 §2・§3・§4.5・§6)

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  applyEdit,
  clinicalDateOf,
  latestDayLabelByDate,
  migrateRecord,
  newEnvelope,
  newerOf,
  nowJstIso,
  upsertByRid,
  type CbtRecord,
  type PatientSettings,
  type RecordType,
} from '@cbt/core';

interface PatientDB extends DBSchema {
  records: {
    key: string; // rid
    value: CbtRecord;
    indexes: { 'by-type': string };
  };
  settings: {
    key: string; // 常に 'settings'
    value: PatientSettings;
  };
}

const DB_NAME = 'cbt-patient';

let dbPromise: Promise<IDBPDatabase<PatientDB>> | null = null;

function db(): Promise<IDBPDatabase<PatientDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PatientDB>(DB_NAME, 1, {
      upgrade(d) {
        const records = d.createObjectStore('records', { keyPath: 'rid' });
        records.createIndex('by-type', 'type');
        d.createObjectStore('settings');
      },
    });
  }
  return dbPromise;
}

/** §3: 起動時にストレージ永続化を要求(OSによる削除リスクの低減) */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // 非対応環境では黙って続行
  }
  return false;
}

// ---- records ----

/**
 * 保存(新規・編集共通)。§4.1: 編集時は updated を更新し、
 * transferred=true なら false に戻して次回転送対象に復帰させる。
 */
export async function saveRecord(record: CbtRecord): Promise<CbtRecord> {
  const touched = applyEdit(record);
  await (await db()).put('records', touched);
  return touched;
}

export async function getAllRecords(): Promise<CbtRecord[]> {
  return (await db()).getAll('records');
}

export async function getRecord(rid: string): Promise<CbtRecord | undefined> {
  return (await db()).get('records', rid);
}

export async function getByType(type: RecordType): Promise<CbtRecord[]> {
  return (await db()).getAllFromIndex('records', 'by-type', type);
}

/**
 * v1.3 移行処理: 旧 three_column → column 等。アプリ起動時に1回呼ぶ(冪等)。
 * updated・transferred は維持する(内容編集ではないため)
 */
export async function runMigrations(): Promise<number> {
  const d = await db();
  const all = await d.getAll('records');
  const changed = all
    .map((r) => ({ before: r, after: migrateRecord(r) }))
    .filter((x) => x.after !== x.before);
  if (changed.length > 0) {
    const tx = d.transaction('records', 'readwrite');
    await Promise.all(changed.map((x) => tx.store.put(x.after)));
    await tx.done;
  }
  return changed.length;
}

/** §4.2: 指定日(臨床日=午前5時区切り)の活動記録を時刻順で返す */
export async function getActivityLogsForDate(date: string): Promise<CbtRecord[]> {
  const logs = await getByType('activity_log');
  return logs
    .filter((r) => r.type === 'activity_log' && clinicalDateOf(r.data.at) === date)
    .sort((a, b) =>
      (a.type === 'activity_log' ? a.data.at : '') < (b.type === 'activity_log' ? b.data.at : '')
        ? -1
        : 1,
    );
}

// ---- 日ラベル(v1.3 §4.2: 1日1つ・任意) ----

export async function getDayLabelForDate(date: string): Promise<CbtRecord | undefined> {
  const labels = await getByType('day_label');
  return latestDayLabelByDate(labels).get(date);
}

/** 設定・変更(既存があれば同一ridを編集)。空文字は何もしない */
export async function saveDayLabel(date: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const existing = await getDayLabelForDate(date);
  const record: CbtRecord =
    existing && existing.type === 'day_label'
      ? { ...existing, data: { date, label: trimmed } }
      : { ...newEnvelope('day_label'), type: 'day_label', data: { date, label: trimmed } };
  await saveRecord(record);
}

/** 自由入力の履歴から候補を作る(頻度順・定番と重複しないもの・最大5件) */
export async function dayLabelSuggestions(exclude: string[]): Promise<string[]> {
  const labels = await getByType('day_label');
  const freq = new Map<string, number>();
  for (const r of labels) {
    if (r.type !== 'day_label') continue;
    const l = r.data.label;
    if (exclude.includes(l)) continue;
    freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => l);
}

/** 今日を含む期間のHW週レコード(複数あれば updated 最新) */
export async function getHomeworkForDate(date: string): Promise<CbtRecord | undefined> {
  const hws = await getByType('homework_week');
  let latest: CbtRecord | undefined;
  for (const r of hws) {
    if (r.type === 'homework_week' && r.data.period.start <= date && date <= r.data.period.end) {
      latest = latest ? newerOf(latest, r) : r;
    }
  }
  return latest;
}

export async function getUntransferred(): Promise<CbtRecord[]> {
  const all = await getAllRecords();
  return all.filter((r) => !r.transferred);
}

/**
 * §5.3 手動ACK: 転送完了の確定。transferred のみ true にする
 * (updated は変更しない。applyEdit を通すと transferred が false に戻るため使わない)
 */
export async function markTransferred(rids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  await Promise.all(
    rids.map(async (rid) => {
      const r = await tx.store.get(rid);
      if (r && !r.transferred) await tx.store.put({ ...r, transferred: true });
    }),
  );
  await tx.done;
}

// ---- settings ----

export const DEFAULT_SETTINGS: PatientSettings = {
  settings_schema: 1,
  pid: '',
  crisis: { clinic: '', after_hours: '' },
  pin: { enabled: false, hash: null },
};

export async function getSettings(): Promise<PatientSettings> {
  const s = await (await db()).get('settings', 'settings');
  return s ?? DEFAULT_SETTINGS;
}

export async function saveSettings(s: PatientSettings): Promise<void> {
  await (await db()).put('settings', s, 'settings');
}

// ---- PIN(§3: 画面上のゲート。暗号化ではない) ----

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ソルト付きハッシュを "salt:hash" 形式で作る */
export async function hashPin(pin: string): Promise<string> {
  const salt = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${salt}:${await sha256Hex(salt + pin)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return (await sha256Hex(salt + pin)) === hash;
}

/** §3: PINリセット=アプリデータ全消去(救済手段なし) */
export async function wipeAllData(): Promise<void> {
  const d = await db();
  await d.clear('records');
  await d.clear('settings');
}

// ---- JSON書き出し・読み込み(§6 設定画面: 機種変更用) ----

export interface ExportFile {
  export_schema: 1;
  exported: string;
  pid: string;
  crisis: PatientSettings['crisis'];
  records: CbtRecord[];
  // §4.5: PINは含めない(新端末で再設定)
}

export async function buildExport(): Promise<ExportFile> {
  const [settings, records] = await Promise.all([getSettings(), getAllRecords()]);
  return {
    export_schema: 1,
    exported: nowJstIso(),
    pid: settings.pid,
    crisis: settings.crisis,
    records,
  };
}

/** 読み込み: レコードはrid単位でupsert(updated新しい方)。pid・連絡先は上書き */
export async function importExport(file: ExportFile): Promise<{ imported: number; total: number }> {
  if (file.export_schema !== 1 || !Array.isArray(file.records)) {
    throw new Error('対応していないファイル形式です');
  }
  const d = await db();
  const existing = await d.getAll('records');
  const merged = upsertByRid(existing, file.records);
  const tx = d.transaction('records', 'readwrite');
  await Promise.all(merged.map((r) => tx.store.put(r)));
  await tx.done;

  const settings = await getSettings();
  await saveSettings({
    ...settings,
    pid: file.pid || settings.pid,
    crisis: {
      clinic: file.crisis?.clinic ?? settings.crisis.clinic,
      after_hours: file.crisis?.after_hours ?? settings.crisis.after_hours,
    },
  });
  return { imported: file.records.length, total: merged.length };
}
