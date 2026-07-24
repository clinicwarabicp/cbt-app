// コラム入力(§4.3 v1.3: 3コラム/7コラム統合型)
// ・列1-3(出来事・気分・自動思考)は従来どおりのウィザード。順番は変更なし
// ・列4-7(根拠/反証/新しい考え方+確信度/気分の再評価)はすべて任意
// ・記録モード(設定): three=列3で保存 / seven=列4-7へ続く(途中保存可)
// ・既存記録の「この考えを検証する」(#/column?rid=...)で列4-7を追記できる
// ・§4.4/§5(v1.3): 今週のrecord課題にコラム対象があれば冒頭に目安と現在数を表示

import { useEffect, useState } from 'preact/hooks';
import {
  clinicalDateOf,
  clinicalTodayJst,
  newEnvelope,
  todayJst,
  validateRecord,
  type CbtRecord,
  type ColumnData,
  type PatientSettings,
} from '@cbt/core';
import { getByType, getHomeworkForDate, getRecord, saveRecord } from '../db';
import { BackLink, Card, CrisisFooter, MoodInput } from '../components';

const EMPTY: ColumnData = {
  occurred: todayJst(),
  event: '',
  moods: [{ label: '', intensity: 50 }],
  thoughts: [{ text: '', belief: 50 }],
};

const STEP_LABELS = [
  '① 出来事',
  '② 気分',
  '③ 自動思考',
  '④ 根拠',
  '⑤ 反証',
  '⑥ 新しい考え方',
  '⑦ 気分の再評価',
];

interface WeekTarget {
  target?: number;
  current: number;
}

/**
 * 列4-7の画面上部に常時表示する列1-3の参照(折りたたみ可・既定は展開)。
 * 認知再構成は元の場面と自動思考を見ながら行う作業のため必須の参照。
 */
function ColumnReference({ data }: { data: ColumnData }) {
  return (
    <details class="col-ref" open>
      <summary>元の記録(列1-3)を見る</summary>
      <div class="col-ref-body">
        <p>
          <b>出来事</b>
          {data.occurred ? `(${data.occurred})` : ''}: {data.event}
        </p>
        <p>
          <b>気分</b>: {data.moods.map((m) => `${m.label} ${m.intensity}`).join('、')}
        </p>
        <p>
          <b>自動思考</b>:{' '}
          {data.thoughts.map((t) => `「${t.text}」確信度${t.belief}`).join('、')}
        </p>
      </div>
    </details>
  );
}

export function ColumnScreen({
  settings,
  params,
}: {
  settings: PatientSettings;
  params: URLSearchParams;
}) {
  const editRid = params.get('rid');
  const sevenMode = settings.column_mode === 'seven';

  const [step, setStep] = useState(1);
  const [data, setData] = useState<ColumnData>(structuredClone(EMPTY));
  const [editing, setEditing] = useState<CbtRecord | null>(null);
  const [weekTarget, setWeekTarget] = useState<WeekTarget | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // 検証モード: 既存レコードを読み込み、列4から開始
  useEffect(() => {
    if (!editRid) return;
    void (async () => {
      const r = await getRecord(editRid);
      if (r && r.type === 'column') {
        setEditing(r);
        setData(structuredClone(r.data));
        setStep(Number(params.get('step') ?? 4));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRid]);

  // 今週のコラム対象record課題(§5: コラムとHW課題の接続)
  useEffect(() => {
    void (async () => {
      const hw = await getHomeworkForDate(clinicalTodayJst());
      if (!hw || hw.type !== 'homework_week') return;
      const task = hw.data.tasks.find((t) => t.kind === 'record' && t.target_type === 'column');
      if (!task) return;
      const columns = await getByType('column');
      const current = columns.filter((r) => {
        const d = clinicalDateOf(r.created);
        return hw.data.period.start <= d && d <= hw.data.period.end;
      }).length;
      setWeekTarget({ target: task.target_count, current });
    })();
  }, []);

  const goesToVerify = sevenMode || editing !== null; // 列4-7へ進むか

  const save = async (finish = true) => {
    const record: CbtRecord =
      editing && editing.type === 'column'
        ? { ...editing, data }
        : { ...newEnvelope('column'), type: 'column', data };
    const errors = validateRecord(record);
    if (errors.length > 0) {
      setError(errors.join(' / '));
      return;
    }
    await saveRecord(record);
    setError('');
    if (editing) {
      setMessage('保存しました。ふりかえりから続きを追記できます。');
      if (finish) location.hash = '#/review';
      return;
    }
    setData(structuredClone(EMPTY));
    setStep(1);
    setMessage('保存しました。もう1場面記録できます。');
  };

  const stepsToShow = goesToVerify ? STEP_LABELS : STEP_LABELS.slice(0, 3);

  return (
    <>
      <BackLink />
      <h1>コラム</h1>

      {weekTarget && (
        <p class="note">
          {weekTarget.target !== undefined
            ? `今週の目安: ${weekTarget.target}場面 ／ 現在: ${weekTarget.current}場面`
            : `今週これまで: ${weekTarget.current}場面`}
        </p>
      )}

      <p class="steps">
        {stepsToShow.map((label, i) => (
          <span class={step === i + 1 ? 'step active' : 'step'}>{label}</span>
        ))}
      </p>
      {message && <div class="banner ok">{message}</div>}

      {step >= 4 && <ColumnReference data={data} />}

      {step === 1 && (
        <Card title="① 出来事 — いつ・どこで・何があったか">
          <label>
            日付(任意){' '}
            <input
              type="date"
              value={data.occurred ?? ''}
              max={todayJst()}
              onChange={(e) =>
                setData((d) => ({ ...d, occurred: e.currentTarget.value || undefined }))
              }
            />
          </label>
          <textarea
            rows={3}
            value={data.event}
            placeholder="例: 会議で意見を否定された(人名・会社名は「上司」「A社」のように)"
            onInput={(e) => setData((d) => ({ ...d, event: e.currentTarget.value }))}
          />
          <details>
            <summary>記入例を見る</summary>
            <p class="example">
              「月曜の朝、会議で自分の提案に上司が『それは違う』と言った。周りは黙っていた。」
              — 事実だけを、カメラで撮ったように書きます。
            </p>
          </details>
          <button
            class="primary"
            disabled={!data.event.trim()}
            onClick={() => {
              setMessage('');
              setStep(2);
            }}
          >
            次へ(気分)
          </button>
        </Card>
      )}

      {step === 2 && (
        <Card title="② そのときの気分(0〜100)">
          {data.moods.map((m, i) => (
            <div class="list-item" key={i}>
              <input
                type="text"
                value={m.label}
                placeholder="気分のことば(例: 恥ずかしい、不安)"
                onInput={(e) => {
                  const label = e.currentTarget.value;
                  setData((d) => ({
                    ...d,
                    moods: d.moods.map((x, j) => (j === i ? { ...x, label } : x)),
                  }));
                }}
              />
              <MoodInput
                label="強さ"
                value={m.intensity}
                onChange={(v) => {
                  const intensity = v ?? 0;
                  setData((d) => ({
                    ...d,
                    moods: d.moods.map((x, j) => (j === i ? { ...x, intensity } : x)),
                  }));
                }}
              />
              {data.moods.length > 1 && (
                <button
                  onClick={() =>
                    setData((d) => ({ ...d, moods: d.moods.filter((_, j) => j !== i) }))
                  }
                >
                  削除
                </button>
              )}
            </div>
          ))}
          <div class="row">
            <button
              onClick={() =>
                setData((d) => ({ ...d, moods: [...d.moods, { label: '', intensity: 50 }] }))
              }
            >
              +気分を追加
            </button>
          </div>
          <div class="row">
            <button onClick={() => setStep(1)}>戻る</button>
            <button
              class="primary"
              disabled={data.moods.some((m) => !m.label.trim())}
              onClick={() => setStep(3)}
            >
              次へ(自動思考)
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="③ 頭に浮かんだ考え(自動思考)と確信度(0〜100)">
          <p class="note">疑問形は言い切りに(例: 「ダメなのでは?」→「自分はダメだ」)</p>
          {data.thoughts.map((t, i) => (
            <div class="list-item" key={i}>
              <textarea
                rows={2}
                value={t.text}
                placeholder="例: 自分は頭が悪い"
                onInput={(e) => {
                  const text = e.currentTarget.value;
                  setData((d) => ({
                    ...d,
                    thoughts: d.thoughts.map((x, j) => (j === i ? { ...x, text } : x)),
                  }));
                }}
              />
              <MoodInput
                label="確信度"
                value={t.belief}
                onChange={(v) => {
                  const belief = v ?? 0;
                  setData((d) => ({
                    ...d,
                    thoughts: d.thoughts.map((x, j) => (j === i ? { ...x, belief } : x)),
                  }));
                }}
              />
              {data.thoughts.length > 1 && (
                <button
                  onClick={() =>
                    setData((d) => ({ ...d, thoughts: d.thoughts.filter((_, j) => j !== i) }))
                  }
                >
                  削除
                </button>
              )}
            </div>
          ))}
          <div class="row">
            <button
              onClick={() =>
                setData((d) => ({ ...d, thoughts: [...d.thoughts, { text: '', belief: 50 }] }))
              }
            >
              +考えを追加
            </button>
          </div>
          {error && <p class="err">{error}</p>}
          <div class="row">
            <button onClick={() => setStep(2)}>戻る</button>
            {goesToVerify ? (
              <>
                <button
                  class="primary"
                  disabled={data.thoughts.some((t) => !t.text.trim())}
                  onClick={() => setStep(4)}
                >
                  次へ(根拠)
                </button>
                <button
                  disabled={data.thoughts.some((t) => !t.text.trim())}
                  onClick={() => void save()}
                >
                  ここで保存して終了
                </button>
              </>
            ) : (
              <button
                class="primary"
                disabled={data.thoughts.some((t) => !t.text.trim())}
                onClick={() => void save()}
              >
                保存する
              </button>
            )}
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="④ 根拠 — その考えを支える事実(任意)">
          <textarea
            rows={3}
            value={data.evidence ?? ''}
            placeholder="例: 上司は語気が強かった"
            onInput={(e) => setData((d) => ({ ...d, evidence: e.currentTarget.value || undefined }))}
          />
          <div class="row">
            <button onClick={() => setStep(3)}>戻る</button>
            <button class="primary" onClick={() => setStep(5)}>
              次へ(反証)
            </button>
            <button onClick={() => void save()}>ここで保存して終了</button>
          </div>
        </Card>
      )}

      {step === 5 && (
        <Card title="⑤ 反証 — その考えに合わない事実(任意)">
          <textarea
            rows={3}
            value={data.counter ?? ''}
            placeholder="例: 同僚は後でフォローしてくれた"
            onInput={(e) => setData((d) => ({ ...d, counter: e.currentTarget.value || undefined }))}
          />
          <div class="row">
            <button onClick={() => setStep(4)}>戻る</button>
            <button class="primary" onClick={() => setStep(6)}>
              次へ(新しい考え方)
            </button>
            <button onClick={() => void save()}>ここで保存して終了</button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card title="⑥ 新しい考え方と確信度(任意)">
          {(data.reframe ?? [{ text: '', belief: 50 }]).map((t, i) => {
            const list = data.reframe ?? [{ text: '', belief: 50 }];
            return (
              <div class="list-item" key={i}>
                <textarea
                  rows={2}
                  value={t.text}
                  placeholder="例: 一つの提案が通らなかっただけで、能力の全否定ではない"
                  onInput={(e) => {
                    const text = e.currentTarget.value;
                    setData((d) => ({
                      ...d,
                      reframe: list.map((x, j) => (j === i ? { ...x, text } : x)),
                    }));
                  }}
                />
                <MoodInput
                  label="確信度"
                  value={t.belief}
                  onChange={(v) => {
                    const belief = v ?? 0;
                    setData((d) => ({
                      ...d,
                      reframe: list.map((x, j) => (j === i ? { ...x, belief } : x)),
                    }));
                  }}
                />
              </div>
            );
          })}
          <div class="row">
            <button onClick={() => setStep(5)}>戻る</button>
            <button class="primary" onClick={() => setStep(7)}>
              次へ(気分の再評価)
            </button>
            <button onClick={() => void save()}>ここで保存して終了</button>
          </div>
        </Card>
      )}

      {step === 7 && (
        <Card title="⑦ 気分の再評価 — いまの気分(任意)">
          <p class="note">はじめに記録した気分(列2)と見比べながら、いまの強さを付けます。</p>
          {(data.moods_after ?? data.moods.map((m) => ({ ...m }))).map((m, i) => {
            const list = data.moods_after ?? data.moods.map((x) => ({ ...x }));
            const original = data.moods[i];
            return (
              <div class="list-item" key={i}>
                <div class="row">
                  <input
                    type="text"
                    value={m.label}
                    onInput={(e) => {
                      const label = e.currentTarget.value;
                      setData((d) => ({
                        ...d,
                        moods_after: list.map((x, j) => (j === i ? { ...x, label } : x)),
                      }));
                    }}
                  />
                  {original && (
                    <span class="note">
                      はじめ: {original.label} <b>{original.intensity}</b>
                    </span>
                  )}
                </div>
                <MoodInput
                  label="いまの強さ"
                  value={m.intensity}
                  onChange={(v) => {
                    const intensity = v ?? 0;
                    setData((d) => ({
                      ...d,
                      moods_after: list.map((x, j) => (j === i ? { ...x, intensity } : x)),
                    }));
                  }}
                />
              </div>
            );
          })}
          {error && <p class="err">{error}</p>}
          <div class="row">
            <button onClick={() => setStep(6)}>戻る</button>
            <button class="primary" onClick={() => void save()}>
              保存する
            </button>
          </div>
        </Card>
      )}

      <CrisisFooter settings={settings} />
    </>
  );
}
