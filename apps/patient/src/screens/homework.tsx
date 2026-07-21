// HW記録(§4.4 v1.2: 「今週の課題と現在の状態」一覧+気づきメモのみの簡素構成)
// record=帳票と紐付け自動判定 / oneshot=済み1タップ / daily=手動日次チェック
// 課題編集UIは折りたたみ(来院時のみ使用)

import { useEffect, useState } from 'preact/hooks';
import {
  addDays,
  clinicalTodayJst,
  newEnvelope,
  recordTaskDoneDates,
  validateRecord,
  type CbtRecord,
  type HomeworkTask,
  type HomeworkWeekData,
  type PatientSettings,
  type RecordType,
} from '@cbt/core';
import { getAllRecords, getHomeworkForDate, saveRecord } from '../db';
import { BackLink, Card, CrisisFooter } from '../components';

const KIND_LABEL = { record: '記録', oneshot: '単発', daily: '日課' } as const;
const TARGET_LABEL: Record<string, string> = {
  activity_log: '活動記録',
  column: 'コラム',
};
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

function datesOf(period: { start: string; end: string }): string[] {
  const dates: string[] = [];
  for (let d = period.start; d <= period.end && dates.length < 14; d = addDays(d, 1)) dates.push(d);
  return dates;
}

export function HomeworkScreen({ settings }: { settings: PatientSettings }) {
  const [record, setRecord] = useState<CbtRecord | null>(null);
  const [data, setData] = useState<HomeworkWeekData | null>(null);
  const [allRecords, setAllRecords] = useState<CbtRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const [existing, all] = await Promise.all([
        getHomeworkForDate(clinicalTodayJst()),
        getAllRecords(),
      ]);
      setAllRecords(all);
      if (existing && existing.type === 'homework_week') {
        setRecord(existing);
        setData(existing.data);
      }
    })();
  }, []);

  const persist = async (next: HomeworkWeekData) => {
    const base: CbtRecord =
      record && record.type === 'homework_week'
        ? { ...record, data: next }
        : { ...newEnvelope('homework_week'), type: 'homework_week', data: next };
    const errors = validateRecord(base);
    const empty = next.tasks.some((t) => !t.content.trim());
    if (errors.length > 0 || empty) {
      setError([...errors, ...(empty ? ['課題の内容が未入力です'] : [])].join(' / '));
      return false;
    }
    const savedRec = await saveRecord(base);
    setRecord(savedRec);
    setData(next);
    setSaved(new Date().toLocaleTimeString('ja-JP'));
    setError('');
    return true;
  };

  const createWeek = () => {
    const start = clinicalTodayJst();
    setData({
      session_no: 1,
      period: { start, end: addDays(start, 6) },
      tasks: [{ no: 1, kind: 'record', content: '活動記録を毎日つける', target_type: 'activity_log' }],
      checks: {},
      memo: '',
    });
    setEditing(true);
  };

  // ---- 状態表示ヘルパ ----
  // 「今日」は臨床日(午前4時区切り)。深夜3時台のチェックは前日扱いになる

  const today = clinicalTodayJst();

  const taskStatus = (t: HomeworkTask) => {
    if (!data) return null;
    if (t.kind === 'record' && t.target_type) {
      const done = recordTaskDoneDates(allRecords, t.target_type, data.period);
      const doneToday = done.has(today);
      return (
        <span class={doneToday ? 'ok' : ''}>
          {doneToday ? '今日実施済み' : '今日まだ'} ／ 実施 {done.size} 日(自動判定)
        </span>
      );
    }
    if (t.kind === 'oneshot') {
      return t.done ? <span class="ok">済み</span> : <span>未実施</span>;
    }
    // daily
    const days = Object.entries(data.checks).filter(([, nos]) => nos.includes(t.no)).length;
    return <span>実施 {days} 日</span>;
  };

  const toggleOneshot = (no: number) => {
    if (!data) return;
    void persist({
      ...data,
      tasks: data.tasks.map((t) => (t.no === no ? { ...t, done: !t.done } : t)),
    });
  };

  const toggleDaily = (date: string, no: number) => {
    if (!data) return;
    const cur = data.checks[date] ?? [];
    const next = cur.includes(no) ? cur.filter((n) => n !== no) : [...cur, no].sort();
    const checks = { ...data.checks };
    if (next.length === 0) delete checks[date];
    else checks[date] = next;
    void persist({ ...data, checks });
  };

  if (!data) {
    return (
      <>
        <BackLink />
        <h1>ホームワーク</h1>
        <Card>
          <p>今週のホームワークはまだ設定されていません。</p>
          <p class="note">課題の内容は、来院時に先生と相談しながら入力します。</p>
          <button class="primary" onClick={createWeek}>
            今週の課題を設定する
          </button>
        </Card>
        <CrisisFooter settings={settings} />
      </>
    );
  }

  const dailyTasks = data.tasks.filter((t) => t.kind === 'daily');

  return (
    <>
      <BackLink />
      <h1>ホームワーク</h1>
      <p class="note">
        第{data.session_no}回 ／ {data.period.start} 〜 {data.period.end}
      </p>
      {error && <div class="banner err">{error}</div>}

      <Card title="今週の課題">
        {data.tasks.map((t) => (
          <div class="list-item row hw-row" key={t.no}>
            <span class="kind-chip">{KIND_LABEL[t.kind]}</span>
            <span class="hw-content">
              {t.content}
              {t.kind === 'record' && t.target_type && (
                <em class="note">
                  ({TARGET_LABEL[t.target_type] ?? t.target_type}に自動連動
                  {t.target_count !== undefined && `・目安${t.target_count}場面`})
                </em>
              )}
            </span>
            {taskStatus(t)}
            {t.kind === 'oneshot' && (
              <button class={t.done ? '' : 'primary'} onClick={() => toggleOneshot(t.no)}>
                {t.done ? '取り消す' : '済みにする'}
              </button>
            )}
          </div>
        ))}
      </Card>

      {dailyTasks.length > 0 && (
        <Card title="日課のチェック">
          <p class="note">少しでも手をつけたら○(タップ)を付けてください。</p>
          {dailyTasks.map((t) => (
            <div class="list-item" key={t.no}>
              <b>
                {t.no}. {t.content}
              </b>
              <div class="day-chips">
                {datesOf(data.period).map((date) => {
                  const checked = (data.checks[date] ?? []).includes(t.no);
                  const future = date > today;
                  return (
                    <button
                      key={date}
                      class={`day-chip${checked ? ' checked' : ''}${date === today ? ' today' : ''}`}
                      disabled={future}
                      onClick={() => toggleDaily(date, t.no)}
                    >
                      {date.slice(8)}
                      <br />
                      {WEEKDAY[new Date(date + 'T00:00:00Z').getUTCDay()]}
                      <br />
                      {checked ? '○' : '·'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title="気づきメモ">
        <textarea
          rows={3}
          value={data.memo ?? ''}
          placeholder="今週気づいたこと(人名・会社名は「上司」「A社」のように)"
          onInput={(e) => setData({ ...data, memo: e.currentTarget.value || undefined })}
        />
        <div class="row">
          <button class="primary" onClick={() => void persist(data)}>
            メモを保存
          </button>
          {saved && <span class="ok">保存しました({saved})</span>}
        </div>
      </Card>

      <details open={editing}>
        <summary class="note">課題を編集(来院時に先生と設定)</summary>
        <Card>
          <div class="row">
            <label>
              第{' '}
              <input
                class="num"
                type="number"
                min={1}
                max={15}
                value={data.session_no}
                onChange={(e) => setData({ ...data, session_no: Number(e.currentTarget.value) })}
              />{' '}
              回
            </label>
            <label>
              開始{' '}
              <input
                type="date"
                value={data.period.start}
                onChange={(e) =>
                  setData({
                    ...data,
                    period: { start: e.currentTarget.value, end: addDays(e.currentTarget.value, 6) },
                  })
                }
              />
            </label>
            <span>〜 {data.period.end}</span>
          </div>
          {data.tasks.map((t, i) => (
            <div class="list-item row" key={i}>
              <b>{t.no}.</b>
              <select
                value={t.kind}
                onChange={(e) => {
                  const kind = e.currentTarget.value as HomeworkTask['kind'];
                  setData({
                    ...data,
                    tasks: data.tasks.map((x, j) =>
                      j === i
                        ? {
                            no: x.no,
                            kind,
                            content: x.content,
                            ...(kind === 'record'
                              ? { target_type: x.target_type ?? ('activity_log' as RecordType) }
                              : {}),
                            ...(kind === 'oneshot' ? { done: x.done ?? false } : {}),
                          }
                        : x,
                    ),
                  });
                }}
              >
                <option value="record">記録系</option>
                <option value="oneshot">単発</option>
                <option value="daily">日課</option>
              </select>
              {t.kind === 'record' && (
                <>
                  <select
                    value={t.target_type}
                    onChange={(e) => {
                      const target_type = e.currentTarget.value as RecordType;
                      setData({
                        ...data,
                        tasks: data.tasks.map((x, j) => (j === i ? { ...x, target_type } : x)),
                      });
                    }}
                  >
                    <option value="activity_log">活動記録</option>
                    <option value="column">コラム</option>
                  </select>
                  <label>
                    目安{' '}
                    <input
                      class="num"
                      type="number"
                      min={1}
                      max={99}
                      value={t.target_count ?? ''}
                      placeholder="-"
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        const target_count = v === '' ? undefined : Number(v);
                        setData({
                          ...data,
                          tasks: data.tasks.map((x, j) => (j === i ? { ...x, target_count } : x)),
                        });
                      }}
                    />
                  </label>
                </>
              )}
              <input
                type="text"
                value={t.content}
                placeholder="課題の内容"
                onInput={(e) => {
                  const content = e.currentTarget.value;
                  setData({
                    ...data,
                    tasks: data.tasks.map((x, j) => (j === i ? { ...x, content } : x)),
                  });
                }}
              />
              {data.tasks.length > 1 && (
                <button
                  onClick={() =>
                    setData({
                      ...data,
                      tasks: data.tasks
                        .filter((_, j) => j !== i)
                        .map((x, j) => ({ ...x, no: j + 1 })),
                    })
                  }
                >
                  削除
                </button>
              )}
            </div>
          ))}
          <div class="row">
            {data.tasks.length < 5 && (
              <button
                onClick={() =>
                  setData({
                    ...data,
                    tasks: [
                      ...data.tasks,
                      { no: data.tasks.length + 1, kind: 'daily', content: '' },
                    ],
                  })
                }
              >
                +課題を追加
              </button>
            )}
            <button class="primary" onClick={() => void persist(data)}>
              課題を保存
            </button>
          </div>
        </Card>
      </details>

      <CrisisFooter settings={settings} />
    </>
  );
}
