// 転送(§5 v1.2: QR表示→治療者の確認→手動ACK)
// 既定は未転送のみ。「過去分も含めて再転送(直近4週)」で転送済みも含める(治療者側はupsertのため安全)

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import {
  addDays,
  clinicalDateOf,
  clinicalTodayJst,
  encodeToFrames,
  nowJstIso,
  type CbtRecord,
  type EncodeResult,
  type PatientSettings,
  type TransferPayload,
} from '@cbt/core';
import { getAllRecords, getUntransferred, markTransferred } from '../db';
import { BackLink, Card } from '../components';

const LABEL: Record<string, string> = {
  activity_log: '活動記録',
  column: 'コラム',
  homework_week: 'ホームワーク',
  day_label: '日ラベル',
};

const FRAME_INTERVAL_MS = 500; // §5.2 確定値
const CHUNK_SIZE = 450; // §5.2 確定値

/** 直近4週(今日を含む28日)に関係するレコードか(臨床日=午前5時区切りで判定) */
function inLast4Weeks(r: CbtRecord): boolean {
  const from = addDays(clinicalTodayJst(), -27);
  if (r.type === 'activity_log') return clinicalDateOf(r.data.at) >= from;
  if (r.type === 'homework_week') return r.data.period.end >= from;
  if (r.type === 'day_label') return r.data.date >= from;
  return clinicalDateOf(r.created) >= from;
}

function countByType(records: CbtRecord[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return [...counts.entries()];
}

export function TransferScreen({ settings }: { settings: PatientSettings }) {
  const [untransferred, setUntransferred] = useState<CbtRecord[]>([]);
  const [allRecords, setAllRecords] = useState<CbtRecord[]>([]);
  const [includePast, setIncludePast] = useState(false);
  const [encoded, setEncoded] = useState<EncodeResult | null>(null);
  const [sentRids, setSentRids] = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [done, setDone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reload = async () => {
    const [un, all] = await Promise.all([getUntransferred(), getAllRecords()]);
    setUntransferred(un);
    setAllRecords(all);
  };

  useEffect(() => {
    void reload();
  }, []);

  const targetRecords = useMemo(() => {
    if (!includePast) return untransferred;
    const map = new Map<string, CbtRecord>();
    for (const r of untransferred) map.set(r.rid, r);
    for (const r of allRecords) {
      if (inLast4Weeks(r)) map.set(r.rid, r);
    }
    return [...map.values()];
  }, [untransferred, allRecords, includePast]);

  const start = () => {
    const payload: TransferPayload = {
      proto: 1,
      pid: settings.pid,
      exported: nowJstIso(),
      records: targetRecords,
    };
    setEncoded(encodeToFrames(payload, { chunkSize: CHUNK_SIZE }));
    setSentRids(targetRecords.map((r) => r.rid));
    setFrameIdx(0);
    setDone(false);
  };

  // フレーム送り(§5.2: 500ms間隔ループ)
  useEffect(() => {
    if (!encoded || encoded.frames.length <= 1 || done) return;
    const t = setInterval(
      () => setFrameIdx((i) => (i + 1) % encoded.frames.length),
      FRAME_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, [encoded, done]);

  // QR描画
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = encoded?.frames[frameIdx];
    if (!canvas || !frame || done) return;
    void QRCode.toCanvas(canvas, frame, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: Math.min(480, window.innerWidth - 64),
    });
  }, [encoded, frameIdx, done]);

  // §5.3: 治療者の件数確認後に患者がACK → transferred確定
  const confirmDone = async () => {
    await markTransferred(sentRids);
    setDone(true);
    setEncoded(null);
    await reload();
  };

  if (!settings.pid) {
    return (
      <>
        <BackLink />
        <h1>転送</h1>
        <Card>
          <p>
            転送にはIDが必要です。<a href="#/settings">設定</a>
            で、先生から伝えられたID(P001など)を入力してください。
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <h1>転送</h1>

      {done && (
        <div class="banner ok">
          転送が完了しました。<b>記録は先生の端末に保存されました。</b>
        </div>
      )}

      {!encoded && (
        <Card>
          <p>
            未転送の記録: <b>{untransferred.length} 件</b>
          </p>
          <ul>
            {countByType(untransferred).map(([type, n]) => (
              <li key={type}>
                {LABEL[type] ?? type}: {n} 件
              </li>
            ))}
          </ul>
          <label class="row">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.currentTarget.checked)}
            />
            過去分も含めて再転送(直近4週 / 合計 {includePast ? targetRecords.length : '–'} 件)
          </label>
          <p class="note">
            誤って「転送完了」を押してしまった場合や、先生の端末のデータ復旧時に使います。重複しても安全です。
          </p>
          <button class="primary big" disabled={targetRecords.length === 0} onClick={start}>
            QRコードを表示する
          </button>
        </Card>
      )}

      {encoded && (
        <Card>
          <div class="qr-wrap">
            <div class="frame-indicator">
              {frameIdx + 1} / {encoded.frames.length}
            </div>
            <canvas ref={canvasRef} />
            <p class="note">
              先生の端末のカメラにかざしてください。読み取りが終わると先生の画面に「
              {settings.pid} から {sentRids.length} 件受信」と表示されます。
            </p>
          </div>
          <div class="row">
            <button class="primary" onClick={() => void confirmDone()}>
              転送完了(先生が件数を確認したら押す)
            </button>
            <button
              onClick={() => {
                setEncoded(null);
              }}
            >
              中止(何も変更されません)
            </button>
          </div>
          <details>
            <summary class="note">開発用: フレーム文字列</summary>
            <pre>{encoded.frames.join('\n')}</pre>
          </details>
        </Card>
      )}
    </>
  );
}
