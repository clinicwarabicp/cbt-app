// 仕様書 v1.1 §4 データスキーマ

export type RecordType = 'activity_log' | 'column' | 'homework_week' | 'day_label';

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

/**
 * §4.3 コラムワークシート(v1.3で3コラム/7コラムを単一型に統合): 1レコード=1場面
 * 列1-3は3コラムと同じ。列4-7はすべて任意(後から「この考えを検証する」で追記可能)
 */
export interface ColumnData {
  occurred?: string;
  event: string; // 列1: 出来事
  moods: { label: string; intensity: number }[]; // 列2: 気分(0-100)
  thoughts: { text: string; belief: number }[]; // 列3: 自動思考(確信度0-100)
  evidence?: string; // 列4: 根拠
  counter?: string; // 列5: 反証
  reframe?: { text: string; belief: number }[]; // 列6: 新しい考え方(確信度0-100)
  moods_after?: { label: string; intensity: number }[]; // 列7: 気分の再評価
}

/** §4.2 日ラベル: 1日1つ(任意)の「その日のメイン」。dateは臨床日(午前4時区切り) */
export interface DayLabelData {
  date: string; // YYYY-MM-DD(臨床日)
  label: string;
}

/** §4.4 課題種別: record=帳票と紐付け自動判定 / oneshot=済み1タップ / daily=手動日次チェック */
export type HomeworkTaskKind = 'record' | 'oneshot' | 'daily';

export interface HomeworkTask {
  no: number;
  kind: HomeworkTaskKind;
  content: string;
  target_type?: RecordType; // kind=record のとき必須
  target_count?: number; // kind=record のとき任意: 週の目安数(例: コラム2場面)
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
    | { type: 'column'; data: ColumnData }
    | { type: 'homework_week'; data: HomeworkWeekData }
    | { type: 'day_label'; data: DayLabelData }
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
  /** v1.3 §4.3: コラムの記録モード。既定は3コラム。切り替えは担当医と相談のうえ行う */
  column_mode?: 'three' | 'seven';
}
