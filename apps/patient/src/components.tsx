import type { ComponentChildren } from 'preact';
import {
  SLOT_HOURS,
  slotCount,
  slotIndexOf,
  slotStartHour,
  type CbtRecord,
  type PatientSettings,
} from '@cbt/core';

/** §6: 危機時の注意書き(全記録画面の下部に常時表示、文言固定) */
export function CrisisFooter({ settings }: { settings: PatientSettings }) {
  const clinic = settings.crisis.clinic || '〇〇(クリニック電話)';
  const after = settings.crisis.after_hours || '△△';
  return (
    <div class="crisis-footer">
      この記録は送信されず、先生が見るのは次の来院時です。つらさが強いとき・緊急のときは、この画面ではなく{' '}
      <b>{clinic}</b>
      /夜間休日は <b>{after}</b> に連絡してください。
    </div>
  );
}

/** 0–100スライダー(v1.3: 5刻み。データ形式は0-100のまま)+未記入対応(mood未記入はnull) */
export function MoodInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div class="mood-input">
      <div class="row">
        <label>
          <input
            type="checkbox"
            checked={value !== null}
            onChange={(e) => onChange(e.currentTarget.checked ? 50 : null)}
          />{' '}
          {label}
        </label>
        <span class="mood-value">{value === null ? '未記入' : value}</span>
      </div>
      {value !== null && (
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onInput={(e) => onChange(Number(e.currentTarget.value))}
        />
      )}
    </div>
  );
}

/**
 * v1.3 §4.2 時間帯マス(4時始まり〜翌3時終わり、SLOT_HOURS刻み)。
 * 表示原則: 達成率・連続日数・「未記録」ラベル・警告色は出さない。
 * 記録があるマスは埋まり、空きマスは薄いグレー枠で控えめに表示する。
 */
export function TimeGrid({
  date,
  logs,
  dayLabel,
  heading,
  onSlotTap,
}: {
  date: string; // 臨床日
  logs: CbtRecord[]; // その臨床日の activity_log
  dayLabel?: string;
  heading?: string;
  onSlotTap?: (slotIndex: number, slotLogs: CbtRecord[]) => void;
}) {
  const bySlot = new Map<number, CbtRecord[]>();
  for (const r of logs) {
    if (r.type !== 'activity_log') continue;
    const idx = slotIndexOf(r.data.at, SLOT_HOURS);
    const list = bySlot.get(idx);
    if (list) list.push(r);
    else bySlot.set(idx, [r]);
  }
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(date + 'T00:00:00Z').getUTCDay()
  ];

  return (
    <div class="time-grid">
      <div class="time-grid-head">
        <span>
          {heading ?? '記録できた時間'} — {date.slice(5).replace('-', '/')}({weekday})
        </span>
        {dayLabel && <span class="day-label-chip">{dayLabel}</span>}
      </div>
      <div class="time-grid-cells">
        {Array.from({ length: slotCount(SLOT_HOURS) }, (_, i) => {
          const slotLogs = bySlot.get(i) ?? [];
          const filled = slotLogs.length > 0;
          return (
            <button
              key={i}
              class={filled ? 'time-cell filled' : 'time-cell'}
              onClick={() => onSlotTap?.(i, slotLogs)}
              aria-label={`${slotStartHour(i, SLOT_HOURS)}時${filled ? '(記録あり)' : ''}`}
            >
              {slotStartHour(i, SLOT_HOURS)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <div class="card">
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export function BackLink() {
  return (
    <a class="back" href="#/">
      ← ホーム
    </a>
  );
}
