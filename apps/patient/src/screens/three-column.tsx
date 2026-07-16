// 3コラム入力(§6: 出来事→気分→自動思考のウィザード形式。記入例を折りたたみ表示)

import { useState } from 'preact/hooks';
import {
  newEnvelope,
  todayJst,
  validateRecord,
  type CbtRecord,
  type PatientSettings,
  type ThreeColumnData,
} from '@cbt/core';
import { saveRecord } from '../db';
import { BackLink, Card, CrisisFooter, MoodInput } from '../components';

const EMPTY: ThreeColumnData = {
  occurred: todayJst(),
  event: '',
  moods: [{ label: '', intensity: 50 }],
  thoughts: [{ text: '', belief: 50 }],
};

export function ThreeColumnScreen({ settings }: { settings: PatientSettings }) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<ThreeColumnData>(structuredClone(EMPTY));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    const record: CbtRecord = { ...newEnvelope('three_column'), type: 'three_column', data };
    const errors = validateRecord(record);
    if (errors.length > 0) {
      setError(errors.join(' / '));
      return;
    }
    await saveRecord(record);
    setData(structuredClone(EMPTY));
    setStep(1);
    setMessage('保存しました。もう1場面記録できます。');
    setError('');
  };

  return (
    <>
      <BackLink />
      <h1>3コラム</h1>
      <p class="steps">
        {['① 出来事', '② 気分', '③ 自動思考'].map((label, i) => (
          <span class={step === i + 1 ? 'step active' : 'step'}>{label}</span>
        ))}
      </p>
      {message && <div class="banner ok">{message}</div>}

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
          <details>
            <summary>記入例を見る</summary>
            <p class="example">「恥ずかしい 75」「不安 60」— ひとことの感情語+強さで書きます。</p>
          </details>
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
            <button
              class="primary"
              disabled={data.thoughts.some((t) => !t.text.trim())}
              onClick={() => void save()}
            >
              保存する
            </button>
          </div>
        </Card>
      )}

      <CrisisFooter settings={settings} />
    </>
  );
}
