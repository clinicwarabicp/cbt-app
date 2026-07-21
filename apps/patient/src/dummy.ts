// M0/M2スパイク用ダミーデータ生成(v1.2スキーマ)
// 週あたり: 活動記録 約25エントリ + 3コラム3場面 + HW週1件

import { newRid, type CbtRecord, type TransferPayload } from '@cbt/core';

const NOTES = [
  'なんとか起きてカーテンを開けた',
  'コンビニまで買い物',
  '横になってスマホを見ていた',
  '洗濯物を干した',
  'ドラマを少し見た',
  '散歩に10分だけ出た',
  '昼食を作って食べた',
  '入浴できた',
  '家族と少し話した',
  '何もできなかった',
];

function iso(day: Date, hour: number, minute: number): string {
  const jst = new Date(day.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10) + `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
}

function dateStr(day: Date): string {
  return new Date(day.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function makeDummyPayload(weeks: number): TransferPayload {
  const records: CbtRecord[] = [];
  const now = new Date();

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(now.getTime() - (w * 7 + d) * 86400e3);
      // 1日 3〜4エントリの活動記録
      const entries = 3 + ((d + w) % 2);
      for (let e = 0; e < entries; e++) {
        const hour = 8 + e * 4 + (d % 3);
        const at = iso(day, Math.min(hour, 23), (e * 17) % 60);
        records.push({
          rid: newRid(),
          type: 'activity_log',
          schema: 1,
          created: at,
          updated: at,
          transferred: false,
          data: {
            at,
            note: NOTES[(d * 4 + e + w) % NOTES.length]!,
            mood: e === 2 && d % 4 === 3 ? null : 20 + ((d * 13 + e * 7) % 60),
          },
        });
      }
    }
    // コラム3場面
    for (let k = 0; k < 3; k++) {
      const day = new Date(now.getTime() - (w * 7 + k * 2) * 86400e3);
      const at = iso(day, 20, 0);
      records.push({
        rid: newRid(),
        type: 'column',
        schema: 1,
        created: at,
        updated: at,
        transferred: false,
        data: {
          occurred: dateStr(day),
          event: '会議で意見を否定された。周りは黙っていた',
          moods: [
            { label: '恥ずかしい', intensity: 75 },
            { label: '不安', intensity: 60 },
          ],
          thoughts: [{ text: '自分は頭が悪い', belief: 80 }],
        },
      });
    }
    // HW週1件(v1.2: 課題種別つき)
    const start = new Date(now.getTime() - (w * 7 + 6) * 86400e3);
    const end = new Date(now.getTime() - w * 7 * 86400e3);
    const endIso = iso(end, 21, 0);
    const checks: Record<string, number[]> = {};
    for (let d = 0; d < 7; d += 2) {
      checks[dateStr(new Date(start.getTime() + d * 86400e3))] = [3];
    }
    records.push({
      rid: newRid(),
      type: 'homework_week',
      schema: 1,
      created: endIso,
      updated: endIso,
      transferred: false,
      data: {
        session_no: 5 - w,
        period: { start: dateStr(start), end: dateStr(end) },
        tasks: [
          { no: 1, kind: 'record', content: '活動記録を毎日つける', target_type: 'activity_log' },
          { no: 2, kind: 'record', content: 'コラムを2場面', target_type: 'column', target_count: 2 },
          { no: 3, kind: 'daily', content: '朝にカーテンを開ける' },
          { no: 4, kind: 'oneshot', content: '散歩コースを決める', done: w % 2 === 0 },
        ],
        checks,
        memo: '水曜は何も手につかなかった',
      },
    });
  }

  return {
    proto: 1,
    pid: 'P001',
    exported: iso(now, new Date().getHours(), 0),
    records,
  };
}
