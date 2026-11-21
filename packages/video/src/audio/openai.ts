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
  speed?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI TTS 어댑터. 기본은 WAV 응답으로 받아 길이를 직접 계산합니다.
 * (MP3로 받으면 길이를 추정하고, 렌더 단계에서 ffmpeg가 실제 길이에 맞춥니다.)
 */
export class OpenAITtsProvider implements TtsProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly format: NonNullable<OpenAITtsOptions["format"]>;
  private readonly speed: number | null;
  private readonly timeoutMs: number;

  constructor(options: OpenAITtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "gpt-4o-mini-tts";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.format = options.format ?? "wav";
    this.speed = options.speed ?? null;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const body: Record<string, unknown> = {
      model: this.model,
      voice: request.voice || "alloy",
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
