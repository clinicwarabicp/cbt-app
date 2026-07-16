// いま記録(§4.2 活動記録: 瞬間記録の積み重ね型)
// したこと+気分だけの最小構成。時刻は自動記入・編集可。保存後は連続入力できる

import { useEffect, useState } from 'preact/hooks';
import {
  isoToLocalInput,
  localInputToIso,
  newEnvelope,
  nowJstIso,
  todayJst,
  type ActivityLogData,
  type CbtRecord,
  type PatientSettings,
} from '@cbt/core';
import { getActivityLogsForDate, saveRecord } from '../db';
import { BackLink, Card, CrisisFooter, MoodInput } from '../components';

export function ActivityLogScreen({ settings }: { settings: PatientSettings }) {
  const [editingRid, setEditingRid] = useState<string | null>(null);
  const [at, setAt] = useState(nowJstIso());
  const [note, setNote] = useState('');
  const [mood, setMood] = useState<number | null>(50);
  const [editTime, setEditTime] = useState(false);
  const [todayLogs, setTodayLogs] = useState<CbtRecord[]>([]);
  const [message, setMessage] = useState('');

  const reloadToday = async () => setTodayLogs(await getActivityLogsForDate(todayJst()));

  useEffect(() => {
    void reloadToday();
  }, []);

  const resetForm = () => {
    setEditingRid(null);
    setAt(nowJstIso());
    setNote('');
    setMood(50);
    setEditTime(false);
  };

  const save = async () => {
    if (!note.trim()) return;
    const data: ActivityLogData = { at, note: note.trim(), mood };
    const existing = editingRid ? todayLogs.find((r) => r.rid === editingRid) : undefined;
    const record: CbtRecord =
      existing && existing.type === 'activity_log'
        ? { ...existing, data }
        : { ...newEnvelope('activity_log'), type: 'activity_log', data };
    await saveRecord(record);
    setMessage(editingRid ? '修正しました' : '記録しました');
    resetForm();
    await reloadToday();
  };

  const startEdit = (r: CbtRecord) => {
    if (r.type !== 'activity_log') return;
    setEditingRid(r.rid);
    setAt(r.data.at);
    setNote(r.data.note);
    setMood(r.data.mood);
    setEditTime(true);
    setMessage('');
  };

  return (
    <>
      <BackLink />
      <h1>いま記録</h1>
      {message && <div class="banner ok">{message}</div>}

      <Card>
        <textarea
          rows={2}
          value={note}
          placeholder="いま、したこと(例: コンビニまで買い物)"
          onInput={(e) => setNote(e.currentTarget.value)}
        />
        <MoodInput
          label="気分(0=とても悪い 〜 100=とても良い)"
          value={mood}
          onChange={setMood}
        />
        <div class="row">
          {editTime ? (
            <input
              type="datetime-local"
              value={isoToLocalInput(at)}
              max={isoToLocalInput(nowJstIso())}
              onChange={(e) => setAt(localInputToIso(e.currentTarget.value))}
            />
          ) : (
            <button class="link-like" onClick={() => setEditTime(true)}>
              時刻: {at.slice(11, 16)}(タップで変更)
            </button>
          )}
        </div>
        <div class="row">
          <button class="primary big" disabled={!note.trim()} onClick={() => void save()}>
            {editingRid ? '修正を保存' : '記録する'}
          </button>
          {editingRid && <button onClick={resetForm}>キャンセル</button>}
        </div>
      </Card>

      {todayLogs.length > 0 && (
        <Card title={`今日の記録(${todayLogs.length}件)`}>
          {todayLogs.map((r) =>
            r.type === 'activity_log' ? (
              <div class="review-row row" key={r.rid}>
                <span class="log-time">{r.data.at.slice(11, 16)}</span>
                <span class="log-note">{r.data.note}</span>
                <span class="mood-value">{r.data.mood === null ? '–' : r.data.mood}</span>
                <button onClick={() => startEdit(r)}>編集</button>
              </div>
            ) : null,
          )}
        </Card>
      )}

      <CrisisFooter settings={settings} />
    </>
  );
}
