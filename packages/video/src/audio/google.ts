import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { concatMp3, mp3DurationMs } from "./mp3";
import { splitNarrationIntoChunks } from "../subtitles";
import type { GeneratedAudio, TtsProvider, TtsRequest, VideoLanguage } from "../types";

/**
 * API 키 없이 쓰는 한국어/영어 음성.
 *
 * Google 번역의 읽어주기(TTS) 엔드포인트는 키 없이 HTTPS로 MP3를 돌려줍니다.
 * 데모·폴백 용도이므로 요청 하나에 200자 제한이 있고, 결과는 항상
 * `provider: "google"`로 표시해 실제 음성(TTS)임을 숨기지 않습니다.
 *
 * 실패(차단·네트워크·한도)하면 예외를 던지고, 호출부(providers.ts)가 음악 폴백으로 넘어갑니다.
 */

const ENDPOINT = "https://translate.google.com/translate_tts";
const MAX_CHUNK_CHARS = 190;
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface GoogleTtsOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** 요청 사이 최소 간격(연속 호출 차단 방지) */
  minIntervalMs?: number;
}

let lastRequestAt = 0;

export class GoogleTtsProvider implements TtsProvider {
  readonly id = "google" as const;
  readonly model = "gtts-free";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;

  constructor(options: GoogleTtsOptions = {}) {
    this.baseUrl = (options.baseUrl ?? ENDPOINT).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const text = request.text.replace(/\s+/g, " ").trim();
    if (!text) throw new Error("나레이션이 비어 있어 음성을 만들 수 없습니다.");

    const chunks = splitNarrationIntoChunks(text, MAX_CHUNK_CHARS);
    const parts: Buffer[] = [];

    for (const chunk of chunks) {
      parts.push(await this.fetchChunk(chunk, request.language));
    }

    const mp3 = concatMp3(parts);
    if (mp3.length === 0) throw new Error("음성 응답이 비어 있습니다.");

    await mkdir(path.dirname(request.outPath), { recursive: true });

    // WAV 경로(.wav)로 넘어와도 실제 바이트는 MP3이므로 확장자를 맞춰 저장합니다.
    const outPath = request.outPath.replace(/\.(wav|pcm)$/i, ".mp3");
    await writeFile(outPath, mp3);

    const measured = mp3DurationMs(mp3);
    return {
      sceneIndex: request.sceneIndex,
      path: outPath,
      durationMs: measured && measured > 0 ? measured : request.targetDurationMs,
      format: "mp3",
      provider: "google",
    };
  }

  private async fetchChunk(text: string, language: VideoLanguage): Promise<Buffer> {
    const wait = this.minIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const url = `${this.baseUrl}?ie=UTF-8&client=tw-ob&ttsspeed=1&tl=${language === "en" ? "en" : "ko"}&total=1&idx=0&textlen=${text.length}&q=${encodeURIComponent(text)}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent": USER_AGENT,
            accept: "audio/mpeg,*/*",
            referer: "https://translate.google.com/",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          lastError = new Error(`무료 TTS 응답 ${response.status}`);
          if (response.status === 429 || response.status >= 500) {
            await sleep(600 * (attempt + 1));
            continue;
          }
          break;
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) {
          lastError = new Error("무료 TTS가 빈 응답을 반환했습니다.");
          continue;
        }
        return bytes;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(400 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("무료 TTS 요청에 실패했습니다.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
