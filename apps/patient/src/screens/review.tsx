// ふりかえり(§6 v1.2: 活動記録を日ごとに時刻順で束ねて表示)。気分推移グラフはM3

import { useEffect, useState } from 'preact/hooks';
import { groupActivityLogsByDate, type CbtRecord } from '@cbt/core';
import { getAllRecords } from '../db';
import { BackLink, Card } from '../components';

export function ReviewScreen() {
  const [records, setRecords] = useState<CbtRecord[]>([]);

  useEffect(() => {
    void getAllRecords().then(setRecords);
  }, []);

  const byDate = groupActivityLogsByDate(records);
  const threeCols = records
    .filter((r) => r.type === 'column')
    .sort((a, b) => (a.created < b.created ? 1 : -1));
  const homeworks = records
    .filter((r) => r.type === 'homework_week')
    .sort((a, b) => (a.created < b.created ? 1 : -1));

  return (
    <>
      <BackLink />
      <h1>ふりかえり</h1>
      <p class="note">気分の推移グラフは次の更新で追加予定です。</p>

      <Card title={`活動記録(${byDate.size}日分)`}>
        {byDate.size === 0 && <p class="note">まだ記録がありません。ホームの「いま記録」から始められます。</p>}
        {[...byDate.entries()].slice(0, 28).map(([date, logs]) => (
          <div class="review-row" key={date}>
            <b>{date}</b>({logs.length}件)
            <div class="review-notes">
              {logs.map((r) =>
                r.type === 'activity_log' ? (
                  <span key={r.rid}>
                    <span class="log-time">{r.data.at.slice(11, 16)}</span> {r.data.note}
                    {r.data.mood !== null && <b> {r.data.mood}</b>}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        ))}
      </Card>

      <Card title={`コラム(${threeCols.length}場面)`}>
        {threeCols.length === 0 && <p class="note">まだ記録がありません。</p>}
        {threeCols.slice(0, 20).map((r) => {
          if (r.type !== 'column') return null;
          const hasVerify =
            r.data.evidence || r.data.counter || r.data.reframe?.length || r.data.moods_after?.length;
          return (
            <div class="review-row" key={r.rid}>
              <b>{r.data.occurred ?? r.created.slice(0, 10)}</b> {r.data.event}
              <div class="review-notes">
                {r.data.moods.map((m) => (
                  <span>
                    {m.label} {m.intensity}
                  </span>
                ))}
                {r.data.thoughts.map((t) => (
                  <span>
                    「{t.text}」確信度{t.belief}
                  </span>
                ))}
                {r.data.evidence && <span>根拠: {r.data.evidence}</span>}
                {r.data.counter && <span>反証: {r.data.counter}</span>}
                {(r.data.reframe ?? []).map((t) => (
                  <span>
                    新しい考え方: 「{t.text}」確信度{t.belief}
                  </span>
                ))}
                {(r.data.moods_after ?? []).map((m) => (
                  <span>
                    再評価: {m.label} {m.intensity}
                  </span>
                ))}
              </div>
              <a class="link-like" href={`#/column?rid=${r.rid}&step=4`}>
                {hasVerify ? '検証の続きを書く' : 'この考えを検証する'}
              </a>
            </div>
          );
        })}
      </Card>

      <Card title={`ホームワーク(${homeworks.length}週分)`}>
        {homeworks.length === 0 && <p class="note">まだ記録がありません。</p>}
        {homeworks.slice(0, 8).map((r) => {
          if (r.type !== 'homework_week') return null;
          return (
            <div class="review-row" key={r.rid}>
              <b>第{r.data.session_no}回</b> {r.data.period.start}〜{r.data.period.end} — 課題{' '}
              {r.data.tasks.length}件
              {r.data.memo && <div class="review-notes">{r.data.memo}</div>}
            </div>
          );
        })}
      </Card>
    </>
  );
}
