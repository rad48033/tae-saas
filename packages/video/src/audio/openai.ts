import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { wavDurationMs } from "./wav";
import type { GeneratedAudio, TtsProvider, TtsRequest } from "../types";

export interface OpenAITtsOptions {
  apiKey: string;
  /** tts-1 | gpt-4o-mini-tts 등 */
  model?: string;
  baseUrl?: string;
  /** OpenAI가 지원하는 응답 포맷. 길이 측정에는 wav가 가장 정확합니다. */
  format?: "wav" | "mp3" | "opus" | "aac" | "flac";
  /** 기본 보이스(요청에 voice가 없을 때). 릴스 기본은 alloy입니다. */
  voice?: string;
  /** 1.0 = 원속. 릴스 템포는 1.25배속을 기본으로 씁니다. */
  speed?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** OpenAI가 받는 speed 범위. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

/**
 * OpenAI TTS 어댑터. 기본은 WAV 응답으로 받아 길이를 직접 계산합니다.
 * (MP3로 받으면 길이를 추정하고, 렌더 단계에서 ffmpeg가 실제 길이에 맞춥니다.)
 *
 * gpt-4o-mini-tts + speed 1.25 + alloy = 릴스 기본 조합입니다.
 * 1.25배속으로 짧아진 음성은 pipeline이 장면 길이에 그대로 반영하므로 무음이 남지 않습니다.
 */
export class OpenAITtsProvider implements TtsProvider {
  readonly id = "openai" as const;
  readonly model: string;
  readonly voice: string;
  readonly speed: number | null;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly format: NonNullable<OpenAITtsOptions["format"]>;
  private readonly timeoutMs: number;

  constructor(options: OpenAITtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gpt-4o-mini-tts";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.format = options.format ?? "wav";
    this.voice = options.voice?.trim() || "alloy";
    this.speed = normalizeSpeed(options.speed);
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const body: Record<string, unknown> = {
      model: this.model,
      voice: request.voice || this.voice,
      input: request.text,
      response_format: this.format,
    };
    if (this.speed) body.speed = this.speed;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/audio/speech`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const text = await response.text();
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await sleep(1_500 * (attempt + 1));
            lastError = new Error(`OpenAI TTS ${response.status}: ${text.slice(0, 300)}`);
            continue;
          }
          throw new Error(`OpenAI TTS ${response.status}: ${text.slice(0, 300)}`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) throw new Error("OpenAI TTS가 빈 오디오를 반환했습니다.");

        await mkdir(path.dirname(request.outPath), { recursive: true });
        await writeFile(request.outPath, bytes);

        const measured = this.format === "wav" ? wavDurationMs(bytes) : null;
        const durationMs = measured ?? request.targetDurationMs;

        return {
          sceneIndex: request.sceneIndex,
          path: request.outPath,
          durationMs,
          format: this.format === "wav" ? "wav" : "mp3",
          provider: "openai",
          model: this.model,
          ...(measured ? { sampleRate: 24_000 } : {}),
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI TTS 요청 시간 초과");
        if (attempt >= 2) throw error instanceof Error ? error : new Error(String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(1_500 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("OpenAI TTS 요청 실패");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 1.0은 원속이므로 보내지 않고, 범위를 벗어난 값은 OpenAI 허용 범위로 자릅니다. */
export function normalizeSpeed(speed: number | undefined): number | null {
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0) return null;
  if (Math.abs(speed - 1) < 0.01) return null;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) * 100) / 100;
}
