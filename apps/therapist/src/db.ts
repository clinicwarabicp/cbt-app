// 治療者側 IndexedDB層(仕様書 §2・§7: 患者別の記録蓄積。正本端末)

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { newerOf, nowJstIso, type CbtRecord } from '@cbt/core';

/** 保存形式: 受信レコード+pid(複合キー) */
export type StoredRecord = CbtRecord & { pid: string };

export interface PatientMeta {
  pid: string;
  lastReceived: string; // ISO 8601
  recordCount: number;
}

interface TherapistDB extends DBSchema {
  records: {
    key: [string, string]; // [pid, rid]
    value: StoredRecord;
    indexes: { 'by-pid': string };
  };
  patients: {
    key: string; // pid
    value: PatientMeta;
  };
}

const DB_NAME = 'cbt-therapist';

let dbPromise: Promise<IDBPDatabase<TherapistDB>> | null = null;

function db(): Promise<IDBPDatabase<TherapistDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TherapistDB>(DB_NAME, 1, {
      upgrade(d) {
        const records = d.createObjectStore('records', { keyPath: ['pid', 'rid'] });
        records.createIndex('by-pid', 'pid');
        d.createObjectStore('patients', { keyPath: 'pid' });
      },
    });
  }
  return dbPromise;
}

export interface ReceiveResult {
  added: number; // 新規
  updated: number; // updatedが新しく上書き
  unchanged: number; // 既知(同一or古い)
}

/**
 * §4.1・§5.3 受信時のupsert: rid一致は updated の新しい方を採用。
 * 再転送・重複送信は常に安全。
 */
export async function saveReceived(pid: string, records: CbtRecord[]): Promise<ReceiveResult> {
  const d = await db();
  const tx = d.transaction(['records', 'patients'], 'readwrite');
  const store = tx.objectStore('records');
  const result: ReceiveResult = { added: 0, updated: 0, unchanged: 0 };

  for (const r of records) {
    const existing = await store.get([pid, r.rid]);
    if (!existing) {
      await store.put({ ...r, pid });
      result.added++;
    } else {
      const newer = newerOf(existing, { ...r, pid } as StoredRecord);
      if (newer === existing) {
        result.unchanged++;
      } else {
        await store.put(newer as StoredRecord);
        result.updated++;
      }
    }
  }

  const count = await store.index('by-pid').count(pid);
  await tx.objectStore('patients').put({ pid, lastReceived: nowJstIso(), recordCount: count });
  await tx.done;
  return result;
}

export async function getPatients(): Promise<PatientMeta[]> {
  const list = await (await db()).getAll('patients');
  return list.sort((a, b) => (a.pid < b.pid ? -1 : 1));
}

export async function getRecordsForPatient(pid: string): Promise<StoredRecord[]> {
  return (await db()).getAllFromIndex('records', 'by-pid', pid);
}
