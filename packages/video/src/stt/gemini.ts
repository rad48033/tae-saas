import { readFile } from "node:fs/promises";
import path from "node:path";

import { aspectPreset } from "../aspect";
import { retryDelayMs } from "../audio/gemini";
import { alignCueTimings, splitNarrationIntoChunks } from "../subtitles";
import type { SttProvider, SttRequest, SttResult, SubtitleCue, VideoLanguage } from "../types";

export const DEFAULT_GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const MIME_BY_EXT: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mp3",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

const LANGUAGE_LABEL: Record<VideoLanguage, string> = { ko: "Korean", en: "English" };

interface TranscribeResponse {
  candidates?: {
    content?: { parts?: { text?: string; audioTranscription?: { text?: string } }[] };
    finishReason?: string | null;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export interface GeminiSttOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Gemini 음성 전사(STT) 어댑터.
 *
 * `gemini-3.5-transcribe`에 장면 음성을 그대로 넣어 실제 발화를 받아 적습니다.
 * 전사문이 나레이션과 다르면(오디오가 깨졌거나 다른 말을 했으면) 그 사실이 자막에 드러납니다.
 * 단어별 타임스탬프는 모델이 주지 않으므로, 전사문을 장면 길이에 맞춰 결정적으로 나눕니다.
 */
export class GeminiSttProvider implements SttProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiSttOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || DEFAULT_GEMINI_TRANSCRIBE_MODEL;
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const warnings: string[] = [];
    const preset = aspectPreset(request.aspectRatio);
    const transcript = await this.transcribeAudio(request);
    const text = transcript?.trim() || "";

    if (!text) {
      warnings.push(`장면 음성 전사 결과가 비어 있어 나레이션으로 자막을 만들었습니다(장면 시작 ${request.startMs}ms).`);
    }

    const source = text || request.narration;
    const chunks = splitNarrationIntoChunks(source, preset.subtitle.maxCharsPerCue);
    const cues: SubtitleCue[] = alignCueTimings(chunks, request.startMs, request.durationMs);

    return {
      cues,
      provider: "gemini",
      ...(text ? { text } : {}),
      warnings,
    };
  }

  private async transcribeAudio(request: SttRequest): Promise<string | null> {
    if (!request.audioPath) return null;
    const bytes = await readFile(request.audioPath);
    if (bytes.length === 0) return null;

    const mimeType = MIME_BY_EXT[path.extname(request.audioPath).toLowerCase()] ?? "audio/wav";
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: bytes.toString("base64") } },
            {
              text:
                `Transcribe the speech in this audio verbatim in ${LANGUAGE_LABEL[request.language]}. ` +
                "Return only the spoken words as plain text, without commentary, timestamps, or quotation marks.",
            },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    };

    const payload = await this.request<TranscribeResponse>(body);
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const fromParts = parts.map((part) => part.text ?? part.audioTranscription?.text ?? "").join(" ").trim();
    return fromParts || null;
  }

  private async request<T>(body: unknown): Promise<T> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const raw = await response.text();
        let parsed: T | null = null;
        try {
          parsed = JSON.parse(raw) as T;
        } catch {
          parsed = null;
        }

        if (!response.ok) {
          const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? raw.slice(0, 300);
          if ((response.status === 429 || response.status >= 500) && attempt < 3) {
            await sleep(retryDelayMs(message, response.status, attempt));
            lastError = new Error(`Gemini STT ${response.status}: ${message}`);
            continue;
          }
          throw new Error(`Gemini STT ${response.status}: ${message}`);
        }
        if (!parsed) throw new Error("Gemini STT 응답을 JSON으로 읽지 못했습니다.");
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("Gemini STT 요청 시간 초과");
        if (attempt >= 3) throw error instanceof Error ? error : new Error(String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(1_500 * (attempt + 1));
      }
    }

    throw lastError ?? new Error("Gemini STT 요청 실패");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
