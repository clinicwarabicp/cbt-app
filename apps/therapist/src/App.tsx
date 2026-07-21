// 治療者側: QR読取画面(M2本実装)
// iPad Safari 本命。BarcodeDetector非対応のため zxing-wasm を使用。
// M0からの修正: 所要時間の計測起点を「sidごと」に持ち、complete時にクリア
// (M0実機検証で報告された45秒表示バグの修正)

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { FrameCollector } from '@cbt/core';
import type { CollectorEvent, TransferPayload } from '@cbt/core';
import { getPatients, runMigrations, saveReceived, type PatientMeta, type ReceiveResult } from './db';

// WASMをCDNではなくアプリと同一オリジンから配信する(オフライン動作・院内ネットワーク要件)
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? wasmUrl : prefix + path,
  },
});

const SCAN_INTERVAL_MS = 120;

interface Progress {
  sid: string;
  received: number;
  total: number;
  missing: number[];
}

interface Result {
  payload: TransferPayload;
  gzipBytes: number;
  elapsedMs: number; // 初フレーム検出→完了
  receive: ReceiveResult; // 保存結果(新規/更新/既知)
}

const LABEL: Record<string, string> = {
  activity_log: '活動記録',
  column: 'コラム',
  homework_week: 'HW',
  day_label: '日ラベル',
};

function summarize(payload: TransferPayload): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of payload.records) {
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([t, c]) => ({ type: LABEL[t] ?? t, count: c }));
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const collectorRef = useRef(new FrameCollector());
  // 計測起点はsid単位で管理する(M0バグ修正: 前セッションからの持ち越しを防ぐ)
  const timingRef = useRef<{ sid: string; startedAt: number } | null>(null);
  const statsRef = useRef({ attempts: 0, hits: 0 });
  const loopRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [hitRate, setHitRate] = useState('');
  const [manualText, setManualText] = useState('');
  const [patients, setPatients] = useState<PatientMeta[]>([]);

  const reloadPatients = useCallback(async () => {
    setPatients(await getPatients());
  }, []);

  useEffect(() => {
    void (async () => {
      await runMigrations(); // v1.3 旧型移行(冪等)
      await reloadPatients();
    })();
  }, [reloadPatients]);

  const handleEvent = useCallback(
    async (ev: CollectorEvent) => {
      if (ev.kind === 'ignored') return;

      if (ev.kind === 'progress') {
        // 新しいsidを見たら計測起点をこのsidで取り直す
        if (timingRef.current?.sid !== ev.sid) {
          timingRef.current = { sid: ev.sid, startedAt: performance.now() };
        }
        setReadError(null);
        setResult(null);
        setProgress({ sid: ev.sid, received: ev.received, total: ev.total, missing: ev.missing });
        return;
      }

      if (ev.kind === 'complete') {
        const startedAt =
          timingRef.current?.sid === ev.sid ? timingRef.current.startedAt : performance.now();
        const elapsedMs = performance.now() - startedAt;
        timingRef.current = null; // 完了で計測をクリア(次セッションに持ち越さない)

        const receive = await saveReceived(ev.payload.pid, ev.payload.records);
        setResult({ payload: ev.payload, gzipBytes: ev.gzipBytes, elapsedMs, receive });
        setProgress(null);
        await reloadPatients();
        return;
      }

      // error
      timingRef.current = null;
      setReadError(
        ev.reason === 'crc_mismatch'
          ? 'CRC照合に失敗しました。QRをかざし直してください(自動で再収集します)'
          : 'データの復元に失敗しました。QRをかざし直してください',
      );
      setProgress(null);
    },
    [reloadPatients],
  );

  const resetSession = useCallback(() => {
    collectorRef.current.reset();
    timingRef.current = null;
    statsRef.current = { attempts: 0, hits: 0 };
    setProgress(null);
    setResult(null);
    setReadError(null);
    setHitRate('');
  }, []);

  const scanOnce = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width === 0) return;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    statsRef.current.attempts++;
    try {
      const results = await readBarcodes(imageData, {
        formats: ['QRCode'],
        maxNumberOfSymbols: 1,
      });
      const text = results[0]?.text;
      if (text) {
        statsRef.current.hits++;
        await handleEvent(collectorRef.current.addFrame(text));
      }
    } catch {
      // 単発の読取失敗は無視(次のフレームで再試行)
    }
    const { attempts, hits } = statsRef.current;
    setHitRate(attempts > 0 ? `${Math.round((hits / attempts) * 100)}%(${hits}/${attempts})` : '');
  }, [handleEvent]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);
    } catch (e) {
      setCameraError(
        `カメラを起動できませんでした: ${e instanceof Error ? e.message : String(e)}` +
          '(HTTPSでアクセスしているか、カメラ許可を確認してください)',
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    setScanning(false);
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await scanOnce();
      if (!cancelled) loopRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (loopRef.current !== null) clearTimeout(loopRef.current);
    };
  }, [scanning, scanOnce]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const addManualFrames = async () => {
    for (const line of manualText.split('\n')) {
      const t = line.trim();
      if (t) await handleEvent(collectorRef.current.addFrame(t));
    }
    setManualText('');
  };

  return (
    <>
      <h1>CBT記録(治療者側)— 読取</h1>

      <div className="card">
        <div className="row">
          {!scanning ? (
            <button className="primary" onClick={() => void startCamera()}>カメラ起動</button>
          ) : (
            <button onClick={stopCamera}>カメラ停止</button>
          )}
          <button onClick={resetSession}>リセット</button>
          {scanning && hitRate && <span className="stats">検出率 {hitRate}</span>}
        </div>
        {cameraError && <p className="err">{cameraError}</p>}
        <video ref={videoRef} playsInline muted style={{ display: scanning ? 'block' : 'none', marginTop: 8 }} />
      </div>

      {(progress || result || readError) && (
        <div className="card">
          {progress && (
            <>
              <div className="progress">
                収集中 {progress.received} / {progress.total}
              </div>
              <div className="stats">
                sid: {progress.sid}
                {progress.missing.length > 0 && progress.missing.length <= 10 && (
                  <> ／ 未受信: {progress.missing.join(', ')}</>
                )}
              </div>
            </>
          )}
          {readError && <div className="err">{readError}</div>}
          {result && (
            <>
              <div className="progress ok">
                {result.payload.pid} から {result.payload.records.length} 件受信(
                {summarize(result.payload)
                  .map((s) => `${s.type}${s.count}`)
                  .join('・')}
                )
              </div>
              <div className="stats">
                保存: 新規 {result.receive.added} ／ 更新 {result.receive.updated} ／ 既知{' '}
                {result.receive.unchanged}(重複・再転送は安全に処理されます)
                <br />
                所要 {(result.elapsedMs / 1000).toFixed(1)} 秒 ／ gzip{' '}
                {result.gzipBytes.toLocaleString()} B ／ exported: {result.payload.exported}
              </div>
              <p className="stats">
                件数を患者に伝え、患者側の<b>「転送完了」</b>を押してもらってください。
              </p>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>受信済み患者</h2>
        {patients.length === 0 ? (
          <p className="stats">まだ受信データがありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>pid</th>
                <th>最終受信</th>
                <th>レコード数</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.pid}>
                  <td>{p.pid}</td>
                  <td>{p.lastReceived.slice(0, 16).replace('T', ' ')}</td>
                  <td>{p.recordCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="stats">閲覧(グラフ・一覧)はM3で追加されます。</p>
      </div>

      <div className="card">
        <details>
          <summary className="stats">カメラなしE2Eテスト(表示側のフレーム文字列を貼り付け)</summary>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="CBTX|1|... を1行1フレームで貼り付け"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void addManualFrames()}>フレーム追加</button>
          </div>
        </details>
      </div>
    </>
  );
}
