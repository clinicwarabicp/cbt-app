// ホーム(§6 v1.3: 「いま記録」1タップ導線+時間帯マス、各帳票への導線、転送ボタン)

import { useEffect, useState } from 'preact/hooks';
import { clinicalTodayJst, slotStartIso, SLOT_HOURS, type CbtRecord, type PatientSettings } from '@cbt/core';
import { getActivityLogsForDate, getDayLabelForDate, getUntransferred } from '../db';
import { TimeGrid } from '../components';

export function Home({ settings }: { settings: PatientSettings }) {
  const [logs, setLogs] = useState<CbtRecord[]>([]);
  const [dayLabel, setDayLabel] = useState<string | undefined>(undefined);
  const [untransferred, setUntransferred] = useState(0);
  const today = clinicalTodayJst();

  useEffect(() => {
    void (async () => {
      const [l, dl, un] = await Promise.all([
        getActivityLogsForDate(today),
        getDayLabelForDate(today),
        getUntransferred(),
      ]);
      setLogs(l);
      setDayLabel(dl && dl.type === 'day_label' ? dl.data.label : undefined);
      setUntransferred(un.length);
    })();
  }, [today]);

  const onSlotTap = (slotIndex: number, slotLogs: CbtRecord[]) => {
    if (slotLogs.length > 0) {
      location.hash = `#/log?slot=${slotIndex}`;
    } else {
      location.hash = `#/log?at=${encodeURIComponent(slotStartIso(today, slotIndex, SLOT_HOURS))}`;
    }
  };

  return (
    <>
      <h1>CBT記録</h1>

      {!settings.pid && (
        <div class="banner">
          初回セットアップ: <a href="#/settings">設定</a>で、先生から伝えられたID(P001など)と連絡先を入力してください。
        </div>
      )}

      <a class="now-button" href="#/log">
        <b>いま記録</b>
        <span>{logs.length > 0 ? `今日 ${logs.length} 件記録できています` : 'タップして最初の記録を'}</span>
      </a>

      <div class="card">
        <TimeGrid date={today} logs={logs} dayLabel={dayLabel} onSlotTap={onSlotTap} />
      </div>

      <nav class="menu">
        <a class="menu-item" href="#/column">
          <b>コラム</b>
          <span>出来事・気分・自動思考</span>
        </a>
        <a class="menu-item" href="#/homework">
          <b>ホームワーク</b>
          <span>今週の課題と状態</span>
        </a>
        <a class="menu-item" href="#/review">
          <b>ふりかえり</b>
          <span>過去の記録を見る</span>
        </a>
        <a class="menu-item" href="#/transfer">
          <b>転送</b>
          <span>未転送 {untransferred} 件</span>
        </a>
        <a class="menu-item" href="#/settings">
          <b>設定</b>
          <span>ID・PIN・書き出し</span>
        </a>
      </nav>
    </>
  );
}
