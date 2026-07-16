// M0スパイク(開発用に保持): ダミーデータのアニメーションQR表示
// 本番の転送画面はM2で実装。実機読取率の再検証にはこの画面を使う

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { encodeToFrames, type EncodeResult } from '@cbt/core';
import { makeDummyPayload } from '../dummy';
import { BackLink } from '../components';

const CHUNK_SIZES = [300, 450, 600];
const INTERVALS_MS = [300, 400, 500];
const WEEKS_OPTIONS = [1, 4];

export function SpikeScreen() {
  const [chunkSize, setChunkSize] = useState(450);
  const [intervalMs, setIntervalMs] = useState(500);
  const [weeks, setWeeks] = useState(1);
  const [encoded, setEncoded] = useState<EncodeResult | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generate = () => {
    const payload = makeDummyPayload(weeks);
    const result = encodeToFrames(payload, { chunkSize });
    setEncoded(result);
    setFrameIdx(0);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing || !encoded || encoded.frames.length <= 1) return;
    const t = setInterval(
      () => setFrameIdx((i) => (i + 1) % encoded.frames.length),
      intervalMs,
    );
    return () => clearInterval(t);
  }, [playing, encoded, intervalMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = encoded?.frames[frameIdx];
    if (!canvas || !frame) return;
    void QRCode.toCanvas(canvas, frame, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: Math.min(480, window.innerWidth - 64),
    });
  }, [encoded, frameIdx]);

  const framesText = useMemo(() => encoded?.frames.join('\n') ?? '', [encoded]);

  return (
    <>
      <BackLink />
      <h1>M0スパイク(開発用)— QR表示テスト</h1>

      <div class="card">
        <div class="row">
          <label>
            チャンク{' '}
            <select value={chunkSize} onChange={(e) => setChunkSize(Number(e.currentTarget.value))}>
              {CHUNK_SIZES.map((s) => (
                <option value={s}>{s}B</option>
              ))}
            </select>
          </label>
          <label>
            間隔{' '}
            <select value={intervalMs} onChange={(e) => setIntervalMs(Number(e.currentTarget.value))}>
              {INTERVALS_MS.map((ms) => (
                <option value={ms}>{ms}ms</option>
              ))}
            </select>
          </label>
          <label>
            データ量{' '}
            <select value={weeks} onChange={(e) => setWeeks(Number(e.currentTarget.value))}>
              {WEEKS_OPTIONS.map((w) => (
                <option value={w}>{w}週分</option>
              ))}
            </select>
          </label>
          <button class="primary" onClick={generate}>
            生成して表示
          </button>
        </div>
      </div>

      {encoded && (
        <div class="card qr-wrap">
          <div class="frame-indicator">
            {frameIdx + 1} / {encoded.frames.length}
          </div>
          <canvas ref={canvasRef} />
          <div class="row">
            <button onClick={() => setPlaying((p) => !p)}>{playing ? '一時停止' : '再生'}</button>
            {!playing && encoded.frames.length > 1 && (
              <button onClick={() => setFrameIdx((i) => (i + 1) % encoded.frames.length)}>
                次フレーム
              </button>
            )}
          </div>
          <div class="stats">
            sid: <b>{encoded.sid}</b> ／ JSON {encoded.stats.jsonBytes.toLocaleString()} B → gzip{' '}
            {encoded.stats.gzipBytes.toLocaleString()} B → {encoded.stats.frameCount} フレーム ／ CRC32:{' '}
            {encoded.stats.crc32}
          </div>
          <details>
            <summary>フレーム文字列(カメラなしE2Eテスト用)</summary>
            <pre>{framesText}</pre>
          </details>
        </div>
      )}
    </>
  );
}
