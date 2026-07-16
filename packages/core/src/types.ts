// 仕様書 v1.1 §4 データスキーマ

export type RecordType = 'activity_log' | 'three_column' | 'homework_week';

/** §4.1 全レコード共通のエンベロープ */
export interface Envelope {
  rid: string; // ULID
  type: RecordType;
  schema: number;
  created: string; // ISO 8601 (+09:00)
  updated: string;
  transferred: boolean;
}

/** §4.2 活動記録(瞬間記録の積み重ね型): 1レコード=1エントリ */
export interface ActivityLogData {
  at: string; // 記録対象時刻(ISO 8601 +09:00)。自動記入・あとから編集可
  note: string;
  mood: number | null; // 0–100(0=とても悪い、100=とても良い)、未記入は null
}

/** §4.3 3コラムワークシート: 1レコード=1場面 */
export interface ThreeColumnData {
  occurred?: string;
  event: string;
  moods: { label: string; intensity: number }[];
  thoughts: { text: string; belief: number }[];
}

/** §4.4 課題種別: record=帳票と紐付け自動判定 / oneshot=済み1タップ / daily=手動日次チェック */
export type HomeworkTaskKind = 'record' | 'oneshot' | 'daily';

export interface HomeworkTask {
  no: number;
  kind: HomeworkTaskKind;
  content: string;
  target_type?: RecordType; // kind=record のとき必須
  done?: boolean; // kind=oneshot のとき使用
}

/** §4.4 今週のホームワーク記録シート: 1レコード=1週間 */
export interface HomeworkWeekData {
  session_no: number;
  period: { start: string; end: string };
  tasks: HomeworkTask[];
  checks: Record<string, number[]>; // daily課題のみ: 日付 → 実施した課題番号
  memo?: string; // 気づきメモ
}

export type CbtRecord = Envelope &
  (
    | { type: 'activity_log'; data: ActivityLogData }
    | { type: 'three_column'; data: ThreeColumnData }
    | { type: 'homework_week'; data: HomeworkWeekData }
  );

/** §5.1 QR転送ペイロード */
export interface TransferPayload {
  proto: 1;
  pid: string; // 例 "P001"
  exported: string; // ISO 8601
  records: CbtRecord[];
}

/** §4.5 患者側設定(QR転送対象外) */
export interface PatientSettings {
  settings_schema: 1;
  pid: string;
  crisis: {
    clinic: string;
    after_hours: string;
  };
  pin: { enabled: boolean; hash: string | null };
}
