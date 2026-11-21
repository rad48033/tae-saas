import { readFile } from "node:fs/promises";
import path from "node:path";

import { aspectPreset } from "../aspect";
import { alignCueTimings, splitNarrationIntoChunks } from "../subtitles";
import type { SttProvider, SttRequest, SttResult, SubtitleCue } from "../types";

export interface OpenAISTTOptions {
  apiKey: string;
  /** whisper-1 등 */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface WhisperWord {
  word?: string;
  start?: number;
  end?: number;
}

interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  words?: WhisperWord[];
  segments?: WhisperSegment[];
  error?: { message?: string };
}

/**
 * OpenAI Whisper(STT) 어댑터.
 * `verbose_json` + word timestamps로 실제 발화 타이밍을 받아 자막을 만듭니다.
 * 실패하면 호출한 쪽(pipeline)이 결정적 정렬로 대체합니다.
 */
export class OpenAISTTProvider implements SttProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAISTTOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || "whisper-1";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const buffer = await readFile(request.audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), path.basename(request.audioPath));
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("language", request.language === "ko" ? "ko" : "en");

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI STT ${response.status}: ${text.slice(0, 300)}`);
    }

    let parsed: WhisperResponse;
    try {
      parsed = JSON.parse(text) as WhisperResponse;
    } catch {
      throw new Error("OpenAI STT 응답을 JSON으로 읽지 못했습니다.");
    }

    const preset = aspectPreset(request.aspectRatio);
    const warnings: string[] = [];
    const words = parsed.words ?? [];
    let cues: SubtitleCue[];

    if (words.length > 0) {
      cues = cuesFromWords(words, request.startMs, parsed.duration ?? request.durationMs / 1000, preset.subtitle.maxCharsPerCue);
    } else if (parsed.segments && parsed.segments.length > 0) {
      cues = parsed.segments
        .filter((segment) => (segment.text ?? "").trim().length > 0)
        .map((segment) => ({
          startMs: Math.round(request.startMs + (segment.start ?? 0) * 1000),
          endMs: Math.round(request.startMs + (segment.end ?? 0) * 1000),
          text: (segment.text ?? "").trim(),
        }));
      warnings.push("Whisper가 단어 타임스탬프를 주지 않아 구간(segment) 타임스탬프로 자막을 만들었습니다.");
    } else {
      const chunks = splitNarrationIntoChunks(parsed.text || request.narration, preset.subtitle.maxCharsPerCue);
      cues = alignCueTimings(chunks, request.startMs, request.durationMs);
      warnings.push("Whisper 응답에 타임스탬프가 없어 나레이션 기준으로 정렬했습니다.");
    }

    if (cues.length === 0) {
      const chunks = splitNarrationIntoChunks(request.narration, preset.subtitle.maxCharsPerCue);
      cues = alignCueTimings(chunks, request.startMs, request.durationMs);
      warnings.push("Whisper가 텍스트를 반환하지 않아 나레이션 기준으로 정렬했습니다.");
    }

    return { cues, provider: "openai", warnings };
  }
}

/** 단어 타임스탬프를 읽기 좋은 자막 컷으로 묶습니다. */
export function cuesFromWords(
  words: WhisperWord[],
  startMs: number,
  audioSeconds: number,
  maxChars: number,
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let current: { start: number; end: number; text: string } | null = null;

  for (const word of words) {
    const text = (word.word ?? "").trim();
    if (!text) continue;
    const start = (word.start ?? 0) * 1000;
    const end = (word.end ?? word.start ?? 0) * 1000;

    if (!current) {
      current = { start, end, text };
      continue;
    }

    const candidate = `${current.text} ${text}`;
    const tooLong = candidate.length > maxChars;
    const tooLate = end - current.start > 4_200;
    if (tooLong || tooLate) {
      cues.push({ startMs: Math.round(startMs + current.start), endMs: Math.round(startMs + current.end), text: current.text });
      current = { start, end, text };
    } else {
      current.text = candidate;
      current.end = Math.max(current.end, end);
    }
  }

  if (current) {
    cues.push({ startMs: Math.round(startMs + current.start), endMs: Math.round(startMs + current.end), text: current.text });
  }

  const audioEnd = Math.round(startMs + audioSeconds * 1000);
  return cues.map((cue) => ({ ...cue, endMs: Math.min(Math.max(cue.endMs, cue.startMs + 300), audioEnd) }));
}
