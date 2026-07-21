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

// ---- 臨床日(1日の区切り=午前4時。v1.3 §4.2) ----
// データは実時刻のまま保存し、日への帰属は表示層で計算する(保存時に丸めない)

export const DAY_BOUNDARY_HOUR = 4;

/** 記録時刻(ISO +09:00)が帰属する「日」。0:00〜3:59は前日に帰属 */
export function clinicalDateOf(iso: string): string {
  const hour = parseInt(iso.slice(11, 13), 10);
  const date = iso.slice(0, 10);
  return hour < DAY_BOUNDARY_HOUR ? addDays(date, -1) : date;
}

/** 今日(臨床日)。深夜3時台は前日扱い */
export function clinicalTodayJst(now: Date = new Date()): string {
  return clinicalDateOf(nowJstIso(now));
}

// ---- 時間帯マス(v1.3 §4.2: 4時始まり〜翌3時終わり) ----
// 粒度は SLOT_HOURS の変更のみで2時間刻みに切り替えられる

export const SLOT_HOURS = 1; // 1 or 2

export function slotCount(slotHours: number = SLOT_HOURS): number {
  return Math.ceil(24 / slotHours);
}

/** 記録時刻 → マス番号(0始まり。0=4時台〜) */
export function slotIndexOf(iso: string, slotHours: number = SLOT_HOURS): number {
  const hour = parseInt(iso.slice(11, 13), 10);
  return Math.floor(((hour - DAY_BOUNDARY_HOUR + 24) % 24) / slotHours);
}

/** マス番号 → 実時刻の開始時(0-23) */
export function slotStartHour(index: number, slotHours: number = SLOT_HOURS): number {
  return (DAY_BOUNDARY_HOUR + index * slotHours) % 24;
}

/** 臨床日+マス番号 → そのマス開始時刻のISO(翌日未明のマスは実日付+1) */
export function slotStartIso(
  clinicalDate: string,
  index: number,
  slotHours: number = SLOT_HOURS,
): string {
  const h = slotStartHour(index, slotHours);
  const date = h < DAY_BOUNDARY_HOUR ? addDays(clinicalDate, 1) : clinicalDate;
  return `${date}T${String(h).padStart(2, '0')}:00:00+09:00`;
}

/** ISO 8601(+09:00) → <input type="datetime-local"> 用の "YYYY-MM-DDTHH:mm" */
export function isoToLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

/** <input type="datetime-local"> の値("YYYY-MM-DDTHH:mm")→ ISO 8601(+09:00) */
export function localInputToIso(value: string): string {
  return value.length === 16 ? value + ':00+09:00' : value + '+09:00';
}
