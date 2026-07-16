// ホーム(§6 v1.2: 「いま記録」1タップ導線、今日の記録件数、各帳票への導線、転送ボタン)

import { useEffect, useState } from 'preact/hooks';
import { todayJst, type PatientSettings } from '@cbt/core';
import { getActivityLogsForDate, getUntransferred } from '../db';
import { Card } from '../components';

export function Home({ settings }: { settings: PatientSettings }) {
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [untransferred, setUntransferred] = useState(0);

  useEffect(() => {
    void (async () => {
      setTodayCount((await getActivityLogsForDate(todayJst())).length);
      setUntransferred((await getUntransferred()).length);
    })();
  }, []);

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
        <span>
          {todayCount === null ? '…' : todayCount === 0 ? '今日はまだ記録がありません' : `今日 ${todayCount} 件記録済み`}
        </span>
      </a>

      <nav class="menu">
        <a class="menu-item" href="#/threecol">
          <b>3コラム</b>
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
