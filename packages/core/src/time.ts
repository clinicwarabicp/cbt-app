// 仕様書 §4.1: 日時は ISO 8601(JST, +09:00)
// 端末のタイムゾーン設定に依存せず、常にJSTで記録する

/** 現在時刻を "YYYY-MM-DDTHH:mm:ss+09:00" で返す */
export function nowJstIso(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 19) + '+09:00';
}

/** 今日の日付(JST)を "YYYY-MM-DD" で返す */
export function todayJst(now: Date = new Date()): string {
  return nowJstIso(now).slice(0, 10);
}

/** "YYYY-MM-DD" に日数を加算 */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO 8601(+09:00) → <input type="datetime-local"> 用の "YYYY-MM-DDTHH:mm" */
export function isoToLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

/** <input type="datetime-local"> の値("YYYY-MM-DDTHH:mm")→ ISO 8601(+09:00) */
export function localInputToIso(value: string): string {
  return value.length === 16 ? value + ':00+09:00' : value + '+09:00';
}
