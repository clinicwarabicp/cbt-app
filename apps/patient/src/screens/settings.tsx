// 設定(§6: pid・PIN・危機時連絡先・JSON書き出し/読み込み)

import { useState } from 'preact/hooks';
import type { PatientSettings } from '@cbt/core';
import {
  buildExport,
  hashPin,
  importExport,
  saveSettings,
  wipeAllData,
  type ExportFile,
} from '../db';
import { BackLink, Card } from '../components';

export function SettingsScreen({
  settings,
  onChanged,
}: {
  settings: PatientSettings;
  onChanged: () => Promise<void>;
}) {
  const [pid, setPid] = useState(settings.pid);
  const [clinic, setClinic] = useState(settings.crisis.clinic);
  const [afterHours, setAfterHours] = useState(settings.crisis.after_hours);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const say = (m: string) => {
    setMessage(m);
    setError('');
  };
  const fail = (m: string) => {
    setError(m);
    setMessage('');
  };

  const saveBasic = async () => {
    if (pid && !/^P\d{3}$/.test(pid)) {
      fail('IDは P+3桁の形式です(例: P001)');
      return;
    }
    await saveSettings({
      ...settings,
      pid,
      crisis: { clinic, after_hours: afterHours },
    });
    await onChanged();
    say('設定を保存しました');
  };

  const setPin = async () => {
    if (!/^\d{4}$/.test(pin1)) {
      fail('PINは4桁の数字です');
      return;
    }
    if (pin1 !== pin2) {
      fail('PINが一致しません');
      return;
    }
    await saveSettings({ ...settings, pin: { enabled: true, hash: await hashPin(pin1) } });
    await onChanged();
    setPin1('');
    setPin2('');
    say('PINを設定しました(次回起動時から有効)');
  };

  const disablePin = async () => {
    await saveSettings({ ...settings, pin: { enabled: false, hash: null } });
    await onChanged();
    say('PINを解除しました');
  };

  const doExport = async () => {
    const data = await buildExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cbt-export-${data.exported.slice(0, 10).replace(/-/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    say('書き出しました。新しい端末へはAirDrop/ニアバイシェア等の端末間直接共有で移してください');
  };

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ExportFile;
      const result = await importExport(parsed);
      await onChanged();
      say(`読み込みました(${result.imported}件を取り込み、合計${result.total}件)`);
    } catch (e) {
      fail(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  };

  const wipe = async () => {
    if (!confirm('アプリ内の記録・設定をすべて消去します。よろしいですか?')) return;
    if (!confirm('本当に全消去しますか? この操作は取り消せません。')) return;
    await wipeAllData();
    await onChanged();
    say('全消去しました');
  };

  return (
    <>
      <BackLink />
      <h1>設定</h1>
      {message && <div class="banner ok">{message}</div>}
      {error && <div class="banner err">{error}</div>}

      <Card title="ID・連絡先(先生と一緒に設定)">
        <label>
          あなたのID(先生から伝えられたもの)
          <input
            type="text"
            value={pid}
            placeholder="P001"
            maxLength={4}
            onInput={(e) => setPid(e.currentTarget.value.toUpperCase())}
          />
        </label>
        <label>
          クリニック連絡先(日中)
          <input
            type="text"
            value={clinic}
            placeholder="〇〇クリニック 00-0000-0000"
            onInput={(e) => setClinic(e.currentTarget.value)}
          />
        </label>
        <label>
          夜間・休日の連絡先
          <input
            type="text"
            value={afterHours}
            placeholder="△△ 00-0000-0000"
            onInput={(e) => setAfterHours(e.currentTarget.value)}
          />
        </label>
        <button class="primary" onClick={() => void saveBasic()}>
          保存
        </button>
      </Card>

      <Card title="PINロック(任意)">
        <p class="note">
          ※PINを忘れた場合の救済手段はありません。PINリセット=アプリ内データの全消去となります。
          PINは画面ロックであり、端末自体の保護はスマホの画面ロック設定に依存します。
        </p>
        {settings.pin.enabled ? (
          <div class="row">
            <span class="ok">PIN設定中</span>
            <button onClick={() => void disablePin()}>PINを解除</button>
          </div>
        ) : (
          <div class="row">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="4桁"
              value={pin1}
              onInput={(e) => setPin1(e.currentTarget.value)}
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="確認"
              value={pin2}
              onInput={(e) => setPin2(e.currentTarget.value)}
            />
            <button onClick={() => void setPin()}>PINを設定</button>
          </div>
        )}
      </Card>

      <details>
        <summary class="note">詳細設定(記録モード)</summary>
        <Card title="コラムの記録モード">
          <p class="note">担当の先生と一緒に切り替えてください。</p>
          <div class="row">
            <label>
              <input
                type="radio"
                name="column_mode"
                checked={(settings.column_mode ?? 'three') === 'three'}
                onChange={() =>
                  void (async () => {
                    await saveSettings({ ...settings, column_mode: 'three' });
                    await onChanged();
                    say('記録モードを3コラムにしました');
                  })()
                }
              />{' '}
              3コラム(出来事・気分・自動思考)
            </label>
          </div>
          <div class="row">
            <label>
              <input
                type="radio"
                name="column_mode"
                checked={settings.column_mode === 'seven'}
                onChange={() =>
                  void (async () => {
                    await saveSettings({ ...settings, column_mode: 'seven' });
                    await onChanged();
                    say('記録モードを7コラムにしました');
                  })()
                }
              />{' '}
              7コラム(根拠・反証・新しい考え方・気分の再評価まで)
            </label>
          </div>
        </Card>
      </details>

      <Card title="機種変更(JSON書き出し・読み込み)">
        <p class="note">
          書き出したファイルは <b>AirDrop・ニアバイシェア等の端末間直接共有</b>で移してください。
          <b>クラウド保存・メール添付は不可</b>です。PINはファイルに含まれません(新端末で再設定)。
        </p>
        <div class="row">
          <button onClick={() => void doExport()}>JSON書き出し</button>
          <label class="file-label">
            JSON読み込み
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void doImport(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </Card>

      <Card title="データの全消去">
        <button class="danger" onClick={() => void wipe()}>
          アプリ内データを全消去
        </button>
      </Card>
    </>
  );
}
