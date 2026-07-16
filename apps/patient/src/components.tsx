import type { ComponentChildren } from 'preact';
import type { PatientSettings } from '@cbt/core';

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

/** 0–100スライダー+未記入対応(仕様: mood未記入はnull) */
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
          step={1}
          value={value}
          onInput={(e) => onChange(Number(e.currentTarget.value))}
        />
      )}
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
