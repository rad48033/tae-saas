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
      const narration = request.narration.replace(/\s+/g, " ").trim();
      const audioSeconds = parsed.duration ?? request.durationMs / 1000;
      // TTS로 읽은 대본은 정확히 알고 있습니다. Whisper는 '언제 말했는지'만 쓰고
      // 화면 글자는 대본 문구를 씁니다(제품명·수치를 잘못 받아쓰는 문제 방지).
      cues = narration
        ? cuesFromScript(narration, words, request.startMs, audioSeconds, preset.subtitle.maxCharsPerCue, preset.subtitle.maxCueMs)
        : cuesFromWords(words, request.startMs, audioSeconds, preset.subtitle.maxCharsPerCue, preset.subtitle.maxCueMs);

      if (narration && similarity(narration, parsed.text ?? "") < 0.45) {
        warnings.push(
          `장면 전사가 대본과 많이 달라(유사도 ${Math.round(similarity(narration, parsed.text ?? "") * 100)}%) 음성 품질을 한 번 들어보세요.`,
        );
      }
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

    return { cues, provider: "openai", ...(parsed.text ? { text: parsed.text } : {}), warnings };
  }
}

/**
 * 대본 문구 + Whisper 단어 타임스탬프.
 *
 * 화면에 띄울 글자는 대본에서 그대로 가져오고, 각 컷이 화면에 머무는 시각만
 * Whisper 단어 타임스탬프로 맞춥니다. TTS가 대본을 읽으므로 단어 순서는 같고,
 * 발음을 잘못 받아쓴 단어("아연"→"아이온")가 자막에 남지 않습니다.
 */
export function cuesFromScript(
  narration: string,
  words: WhisperWord[],
  startMs: number,
  audioSeconds: number,
  maxCharsPerCue: number,
  maxCueMs = 2_500,
): SubtitleCue[] {
  const spoken = words.filter((word) => (word.word ?? "").trim().length > 0);
  const text = narration.replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (spoken.length === 0) {
    return alignCueTimings(splitNarrationIntoChunks(text, maxCharsPerCue), startMs, audioSeconds * 1000);
  }

  const scriptWords = text.split(" ");
  const totalWords = Math.max(1, scriptWords.length);
  const ratio = spoken.length / totalWords;
  // 대본 어절 i는 Whisper 어절 round(i*ratio)에 대응합니다(TTS가 대본을 그대로 읽음).
  const timeAt = (index: number) => {
    const spokenIndex = Math.min(spoken.length - 1, Math.max(0, Math.round(index * ratio)));
    const word = spoken[spokenIndex];
    return {
      startMs: Math.round(startMs + (word?.start ?? 0) * 1000),
      endMs: Math.round(startMs + (word?.end ?? word?.start ?? 0) * 1000),
    };
  };

  // 말 속도(글자/초)로 한 컷에 담을 글자 수를 정합니다.
  const speechSeconds = Math.max(
    0.5,
    (spoken[spoken.length - 1]?.end ?? audioSeconds) - (spoken[0]?.start ?? 0),
  );
  const charsPerSecond = text.replace(/\s+/g, "").length / speechSeconds;
  const charBudget = Math.max(6, Math.min(maxCharsPerCue, Math.round(charsPerSecond * (maxCueMs / 1000))));

  const grouped: { text: string; startMs: number; endMs: number }[] = [];
  let current: { words: string[]; startMs: number; endMs: number } | null = null;

  scriptWords.forEach((word, index) => {
    const time = timeAt(index);
    if (!current) {
      current = { words: [word], startMs: time.startMs, endMs: Math.max(time.endMs, time.startMs + 200) };
      return;
    }

    const candidateText = `${current.words.join(" ")} ${word}`;
    const candidateEnd = Math.max(current.endMs, time.endMs);
    const endsClause = /[,.?!。？！]$/u.test(word);
    const tooLong = candidateEnd - current.startMs > maxCueMs;
    const tooWide = candidateText.length > charBudget;

    // 너무 길어지기 전에, 문장부호나 어절 경계에서 끊습니다.
    if (tooLong || tooWide) {
      const canBreakBefore = current.endMs - current.startMs >= maxCueMs * 0.45;
      if (canBreakBefore) {
        grouped.push({ text: current.words.join(" "), startMs: current.startMs, endMs: current.endMs });
        current = { words: [word], startMs: time.startMs, endMs: Math.max(time.endMs, time.startMs + 200) };
      } else {
        current.words.push(word);
        current.endMs = candidateEnd;
      }
      return;
    }

    current.words.push(word);
    current.endMs = candidateEnd;

    // 문장부호 뒤이면서 절반 이상 읽었으면 여기서 끊어 읽기 리듬을 살립니다.
    if (endsClause && current.endMs - current.startMs >= maxCueMs * 0.55) {
      grouped.push({ text: current.words.join(" "), startMs: current.startMs, endMs: current.endMs });
      current = null;
    }
  });

  if (current) {
    const tail = current as { words: string[]; startMs: number; endMs: number };
    const last = grouped[grouped.length - 1];
    const tooShort = tail.endMs - tail.startMs < 900;
    // 마지막에 한 어절만 남으면 앞 컷에 붙여 0.5초짜리 깜빡임을 만들지 않습니다.
    if (last && tooShort && `${last.text} ${tail.words.join(" ")}`.length <= charBudget * 1.4) {
      last.text = `${last.text} ${tail.words.join(" ")}`;
      last.endMs = tail.endMs;
    } else {
      grouped.push({ text: tail.words.join(" "), startMs: tail.startMs, endMs: tail.endMs });
    }
  }

  const cues = grouped
    .map((cue) => ({ ...cue, text: stripTrailingPunctuation(cue.text) }))
    .filter((cue) => cue.text.length > 0);

  return normalizeCues(cues, startMs + audioSeconds * 1000, maxCueMs);
}

/** 자막 끝에 남는 쉼표·마침표는 읽는 데 방해가 되므로 걷어냅니다(숫자·%는 유지). */
function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s,、，.。]+$/u, "").trim() || text.trim();
}

/** 너무 길거나 짧은 자막 컷을 읽기 좋은 길이로 다듬고, 컷이 겹치지 않게 정리합니다. */
export function normalizeCues(cues: SubtitleCue[], audioEndMs: number, maxCueMs: number): SubtitleCue[] {
  const split: SubtitleCue[] = [];
  for (const cue of cues) {
    if (cue.endMs - cue.startMs <= maxCueMs * 1.1) {
      split.push(cue);
      continue;
    }
    // 긴 컷은 대본 중간(가장 가까운 어절 경계)에서 두 컷으로 나눕니다.
    const words = cue.text.split(" ");
    if (words.length < 4) {
      split.push(cue);
      continue;
    }
    const half = Math.ceil(words.length / 2);
    const midMs = Math.round(cue.startMs + (cue.endMs - cue.startMs) * (half / words.length));
    split.push({ startMs: cue.startMs, endMs: midMs, text: stripTrailingPunctuation(words.slice(0, half).join(" ")) });
    split.push({ startMs: midMs, endMs: cue.endMs, text: stripTrailingPunctuation(words.slice(half).join(" ")) });
  }

  const MIN_CUE_MS = 700;
  return split.map((cue, index) => {
    const next = split[index + 1];
    const endLimit = Math.min(audioEndMs, next ? next.startMs : audioEndMs);
    const endMs = Math.max(cue.startMs + 300, Math.min(Math.max(cue.endMs, cue.startMs + MIN_CUE_MS), endLimit));
    return { ...cue, endMs: Math.round(endMs) };
  });
}

/** 단어 타임스탬프를 읽기 좋은 자막 컷으로 묶습니다. */
export function cuesFromWords(
  words: WhisperWord[],
  startMs: number,
  audioSeconds: number,
  maxChars: number,
  maxCueMs = 4_200,
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
    // 릴스는 2~2.5초마다 자막이 바뀌어야 말의 흐름을 놓치지 않습니다.
    const tooLate = end - current.start > maxCueMs;
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

/** 대본과 전사문의 문자 2-gram 자카드 유사도(0~1). 음성 품질 확인용. */
export function similarity(a: string, b: string): number {
  const normalize = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
    return set;
  };
  const first = grams(left);
  const second = grams(right);
  let overlap = 0;
  for (const gram of first) if (second.has(gram)) overlap += 1;
  return (2 * overlap) / (first.size + second.size);
}
