// 仕様書 v1.1 §5 QR転送プロトコル
// JSON → gzip(pako) → Base64url → 分割 → QRフレーム化
// フレーム形式: CBTX|1|<sid>|<seq>/<total>|<crc32>|<chunk>

import { gzip, ungzip } from 'pako';
import { crc32Hex } from './crc32';
import { toBase64url, fromBase64url } from './base64url';
import type { TransferPayload } from './types';

export const FRAME_PREFIX = 'CBTX';
export const FRAME_PROTO = 1;
/** §5.2: 1フレームあたり400〜500バイト目安(QR v13〜15程度・誤り訂正M) */
export const DEFAULT_CHUNK_SIZE = 450;

const SID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外

export function randomSid(): string {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += SID_CHARS[Math.floor(Math.random() * SID_CHARS.length)];
  }
  return s;
}

export interface EncodeStats {
  jsonBytes: number;
  gzipBytes: number;
  base64Chars: number;
  frameCount: number;
  crc32: string;
}

export interface EncodeResult {
  sid: string;
  frames: string[];
  stats: EncodeStats;
}

export function encodeToFrames(
  payload: TransferPayload,
  options: { chunkSize?: number; sid?: string } = {},
): EncodeResult {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const json = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(json);
  const gz = gzip(jsonBytes);
  const crc = crc32Hex(gz);
  const b64 = toBase64url(gz);

  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
  }
  if (chunks.length === 0) chunks.push('');

  const sid = options.sid ?? randomSid();
  const total = chunks.length;
  const frames = chunks.map(
    (chunk, i) => `${FRAME_PREFIX}|${FRAME_PROTO}|${sid}|${i + 1}/${total}|${crc}|${chunk}`,
  );

  return {
    sid,
    frames,
    stats: {
      jsonBytes: jsonBytes.length,
      gzipBytes: gz.length,
      base64Chars: b64.length,
      frameCount: total,
      crc32: crc,
    },
  };
}

export interface ParsedFrame {
  sid: string;
  seq: number; // 1始まり
  total: number;
  crc: string;
  chunk: string;
}

/** フレーム文字列を解析。本プロトコルのフレームでなければ null */
export function parseFrame(text: string): ParsedFrame | null {
  const parts = text.split('|');
  if (parts.length !== 6) return null;
  const [prefix, proto, sid, seqTotal, crc, chunk] = parts as [
    string, string, string, string, string, string,
  ];
  if (prefix !== FRAME_PREFIX || proto !== String(FRAME_PROTO)) return null;
  const m = /^(\d+)\/(\d+)$/.exec(seqTotal);
  if (!m) return null;
  const seq = parseInt(m[1]!, 10);
  const total = parseInt(m[2]!, 10);
  if (!(total >= 1 && seq >= 1 && seq <= total)) return null;
  if (!/^[0-9a-f]{8}$/.test(crc)) return null;
  if (sid.length !== 4) return null;
  return { sid, seq, total, crc, chunk };
}

export type CollectorEvent =
  | { kind: 'ignored' } // 本プロトコルのフレームではない/不整合フレーム
  | {
      kind: 'progress';
      sid: string;
      received: number;
      total: number;
      isNewFrame: boolean;
      missing: number[];
    }
  | { kind: 'complete'; sid: string; payload: TransferPayload; gzipBytes: number }
  | { kind: 'error'; sid: string; reason: 'crc_mismatch' | 'decode_failed' };

/**
 * §5.2 読取側: sid が一致するフレームを揃うまで収集する。
 * - 新しい sid のフレームが来たら収集をリセットして乗り換える(最新の転送セッション優先)
 * - 全フレーム結合・Base64urlデコード後に CRC32 を照合。不一致はエラーとして通知し、リセット
 * - complete 後の同一 sid フレームは ignored
 */
export class FrameCollector {
  private sid: string | null = null;
  private total = 0;
  private crc = '';
  private chunks = new Map<number, string>();
  private done = false;

  reset(): void {
    this.sid = null;
    this.total = 0;
    this.crc = '';
    this.chunks.clear();
    this.done = false;
  }

  get currentSid(): string | null {
    return this.sid;
  }

  addFrame(text: string): CollectorEvent {
    const frame = parseFrame(text);
    if (!frame) return { kind: 'ignored' };

    if (this.sid !== frame.sid) {
      // 新しい転送セッションに乗り換え
      this.reset();
      this.sid = frame.sid;
      this.total = frame.total;
      this.crc = frame.crc;
    } else {
      if (this.done) return { kind: 'ignored' };
      // 同一 sid で total/crc が食い違うフレームは破損とみなし無視
      if (frame.total !== this.total || frame.crc !== this.crc) {
        return { kind: 'ignored' };
      }
    }

    const isNewFrame = !this.chunks.has(frame.seq);
    this.chunks.set(frame.seq, frame.chunk);

    if (this.chunks.size < this.total) {
      return {
        kind: 'progress',
        sid: frame.sid,
        received: this.chunks.size,
        total: this.total,
        isNewFrame,
        missing: this.missingSeqs(),
      };
    }

    // 全フレーム収集完了 → 結合・照合・復元
    let joined = '';
    for (let i = 1; i <= this.total; i++) {
      joined += this.chunks.get(i)!;
    }
    let gz: Uint8Array;
    try {
      gz = fromBase64url(joined);
    } catch {
      const sid = this.sid!;
      this.reset();
      return { kind: 'error', sid, reason: 'decode_failed' };
    }
    if (crc32Hex(gz) !== this.crc) {
      const sid = this.sid!;
      this.reset();
      return { kind: 'error', sid, reason: 'crc_mismatch' };
    }
    let payload: TransferPayload;
    try {
      const json = new TextDecoder().decode(ungzip(gz));
      payload = JSON.parse(json) as TransferPayload;
      if (payload.proto !== 1 || typeof payload.pid !== 'string' || !Array.isArray(payload.records)) {
        throw new Error('invalid payload');
      }
    } catch {
      const sid = this.sid!;
      this.reset();
      return { kind: 'error', sid, reason: 'decode_failed' };
    }
    this.done = true;
    return { kind: 'complete', sid: this.sid!, payload, gzipBytes: gz.length };
  }

  private missingSeqs(): number[] {
    const missing: number[] = [];
    for (let i = 1; i <= this.total; i++) {
      if (!this.chunks.has(i)) missing.push(i);
    }
    return missing;
  }
}
