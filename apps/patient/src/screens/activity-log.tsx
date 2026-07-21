// いま記録(§4.2 v1.3: 時間帯マス方式)
// ・「いま記録」= 現在時刻で入力画面(従来どおり)
// ・空きマスタップ → その時間帯が初期値に入った入力画面(#/log?at=...)
// ・記録済みマスタップ → 既存エントリの閲覧・編集(#/log?slot=N)
// ・その日の日ラベルが未設定のときだけ、上部に日ラベル設定を表示
// 表示原則: 達成率・「未記録」ラベル・警告色は出さない

import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  clinicalDateOf,
  isoToLocalInput,
  localInputToIso,
  newEnvelope,
  nowJstIso,
  SLOT_HOURS,
  slotIndexOf,
  slotStartIso,
  type ActivityLogData,
  type CbtRecord,
  type PatientSettings,
} from '@cbt/core';
import {
  dayLabelSuggestions,
  getActivityLogsForDate,
  getDayLabelForDate,
  saveDayLabel,
  saveRecord,
} from '../db';
import { BackLink, Card, CrisisFooter, MoodInput, TimeGrid } from '../components';

/** 定番ボタン: 中立な事実ラベルのみ(評価語は置かない) */
const PRESET_LABELS = ['仕事', '休み', '通院'];

export function ActivityLogScreen({
  settings,
  params,
}: {
  settings: PatientSettings;
  params: URLSearchParams;
}) {
  const initialAt = params.get('at') ?? nowJstIso();
  const initialSlot = params.get('slot');

  const [editingRid, setEditingRid] = useState<string | null>(null);
  const [at, setAt] = useState(initialAt);
  const [note, setNote] = useState('');
  const [mood, setMood] = useState<number | null>(50);
  const [editTime, setEditTime] = useState(params.has('at'));
  const [selectedSlot, setSelectedSlot] = useState<number | null>(
    initialSlot !== null ? Number(initialSlot) : null,
  );
  const [dayLogs, setDayLogs] = useState<CbtRecord[]>([]);
  const [dayLabel, setDayLabel] = useState<string | undefined>(undefined);
  const [labelInput, setLabelInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const day = clinicalDateOf(at); // この画面が扱う臨床日

  const reload = async () => {
    const [logs, dl, sug] = await Promise.all([
      getActivityLogsForDate(day),
      getDayLabelForDate(day),
      dayLabelSuggestions(PRESET_LABELS),
    ]);
    setDayLogs(logs);
    setDayLabel(dl && dl.type === 'day_label' ? dl.data.label : undefined);
    setSuggestions(sug);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

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
    const existing = editingRid ? dayLogs.find((r) => r.rid === editingRid) : undefined;
    const record: CbtRecord =
      existing && existing.type === 'activity_log'
        ? { ...existing, data }
        : { ...newEnvelope('activity_log'), type: 'activity_log', data };
    await saveRecord(record);
    setMessage(editingRid ? '修正しました' : '記録しました');
    resetForm();
    await reload();
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

  const applyLabel = async (label: string) => {
    await saveDayLabel(day, label);
    setLabelInput('');
    await reload();
  };

  const onSlotTap = (slotIndex: number, slotLogs: CbtRecord[]) => {
    if (slotLogs.length > 0) {
      setSelectedSlot(slotIndex);
    } else {
      setSelectedSlot(null);
      setEditingRid(null);
      setAt(slotStartIso(day, slotIndex, SLOT_HOURS));
      setEditTime(true);
      setMessage('');
    }
  };

  const listLogs = useMemo(
    () =>
      selectedSlot === null
        ? dayLogs
        : dayLogs.filter(
            (r) => r.type === 'activity_log' && slotIndexOf(r.data.at, SLOT_HOURS) === selectedSlot,
          ),
    [dayLogs, selectedSlot],
  );

  return (
    <>
      <BackLink />
      <h1>いま記録</h1>
      {message && <div class="banner ok">{message}</div>}

      {!dayLabel && (
        <Card>
          <p class="note">今日はどんな日でしたか?(任意・あとで変えられます)</p>
          <div class="row">
            {PRESET_LABELS.map((l) => (
              <button key={l} onClick={() => void applyLabel(l)}>
                {l}
              </button>
            ))}
            {suggestions.map((l) => (
              <button key={l} onClick={() => void applyLabel(l)}>
                {l}
              </button>
            ))}
          </div>
          <div class="row">
            <input
              type="text"
              value={labelInput}
              placeholder="自由に入力(例: 帰省)"
              onInput={(e) => setLabelInput(e.currentTarget.value)}
            />
            <button disabled={!labelInput.trim()} onClick={() => void applyLabel(labelInput)}>
              設定
            </button>
          </div>
        </Card>
      )}

      <Card>
        <textarea
          rows={2}
          value={note}
          placeholder="したこと(例: コンビニまで買い物)"
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

      <Card>
        <TimeGrid date={day} logs={dayLogs} dayLabel={dayLabel} onSlotTap={onSlotTap} />
        {selectedSlot !== null && (
          <button class="link-like" onClick={() => setSelectedSlot(null)}>
            すべての時間を表示
          </button>
        )}
      </Card>

      {listLogs.length > 0 && (
        <Card
          title={
            selectedSlot === null
              ? `この日の記録(${listLogs.length}件)`
              : `この時間の記録(${listLogs.length}件)`
          }
        >
          {listLogs.map((r) =>
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
