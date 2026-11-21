import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeWav } from "./wav";
import type { GeneratedAudio, TtsProvider, TtsRequest, VideoLanguage } from "../types";

const SAMPLE_RATE = 24_000;

/**
 * API 키가 없을 때 쓰는 결정적 음성 생성기.
 *
 * 실제 발음을 합성하지는 않습니다. 대신 나레이션의 음절 수·문장 부호·띄어쓰기를 따라
 * 음높이와 길이가 변하는 "말하는 리듬"의 톤을 만듭니다. 목표 길이에 정확히 맞추므로
 * 자막 타이밍·장면 길이 검증에는 충분하고, 결과에는 항상 demo 제공자로 표시됩니다.
 */
export class DemoTtsProvider implements TtsProvider {
  readonly id = "demo" as const;
  readonly model = "demo-speech-cadence";

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const durationMs = Math.max(1_000, Math.round(request.targetDurationMs));
    const samples = renderSpeechCadence(request.text, durationMs, request.sceneIndex, request.language);
    const wav = encodeWav(samples, SAMPLE_RATE);

    await mkdir(path.dirname(request.outPath), { recursive: true });
    await writeFile(request.outPath, wav);

    return {
      sceneIndex: request.sceneIndex,
      path: request.outPath,
      durationMs,
      format: "wav",
      provider: "demo",
      sampleRate: SAMPLE_RATE,
    };
  }
}

interface Unit {
  text: string;
  /** 초 */
  seconds: number;
  /** 말소리인지 쉼인지 */
  voiced: boolean;
  /** 문장 끝 억양 */
  terminal: boolean;
}

/** 나레이션을 음절 단위로 나누고 길이를 배분합니다. */
export function planUnits(text: string, totalMs: number, language: VideoLanguage): Unit[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chars = [...normalized];
  const units: Unit[] = [];

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char === " ") {
      units.push({ text: " ", seconds: 0, voiced: false, terminal: false });
      continue;
    }
    if (/[.!?。？！]/.test(char)) {
      units.push({ text: char, seconds: 0, voiced: false, terminal: true });
      continue;
    }
    if (/[,、，·]/.test(char)) {
      units.push({ text: char, seconds: 0, voiced: false, terminal: false });
      continue;
    }
    units.push({ text: char, seconds: 0, voiced: true, terminal: false });
  }

  const voicedCount = units.filter((unit) => unit.voiced).length || 1;
  const pauses = units.filter((unit) => !unit.voiced);
  const pauseShare = language === "ko" ? 0.18 : 0.12;
  const pauseSeconds = pauses.reduce(
    (sum, unit) => sum + (unit.terminal ? 0.32 : unit.text === " " ? 0 : 0.12),
    0,
  );
  const pauseTotal = Math.min(totalMs / 1000 * pauseShare, pauseSeconds || totalMs / 1000 * pauseShare);
  const voicedTotal = Math.max(0.3, totalMs / 1000 - pauseTotal);
  const perUnit = voicedTotal / voicedCount;

  for (const unit of units) {
    if (unit.voiced) {
      unit.seconds = perUnit;
    } else if (unit.text === " ") {
      unit.seconds = Math.min(0.09, (totalMs / 1000) * 0.03);
    } else if (unit.terminal) {
      unit.seconds = Math.min(0.36, perUnit * 1.6);
    } else {
      unit.seconds = Math.min(0.16, perUnit * 0.7);
    }
  }

  return units;
}

export function renderSpeechCadence(text: string, totalMs: number, sceneIndex: number, language: VideoLanguage): Float32Array {
  const totalSamples = Math.max(1, Math.round((totalMs / 1000) * SAMPLE_RATE));
  const out = new Float32Array(totalSamples);
  const units = planUnits(text, totalMs, language);
  if (units.length === 0) return out;

  const random = seededRandom(0x9e3779b9 ^ (sceneIndex * 2654435761));

  let cursor = 0;
  // 문장이 바뀔 때 음높이를 살짝 올립니다(말하는 느낌).
  let baseF0 = 128 + random() * 26;
  let sentencePosition = 0;

  for (const unit of units) {
    const length = Math.round(unit.seconds * SAMPLE_RATE);
    if (unit.voiced) {
      const jitter = 1 + (random() - 0.5) * 0.14;
      const f0 = baseF0 * jitter * (1 + Math.min(0.12, sentencePosition * 0.004));
      const amplitude = 0.42 + random() * 0.16;

      for (let index = 0; index < length; index += 1) {
        const position = index / Math.max(1, length - 1);
        // 어택/릴리즈가 있는 음절 포락선
        const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, position))) ** 1.2;
        const t = (cursor + index) / SAMPLE_RATE;
        const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t);
        const phase = f0 * vibrato;

        let sample =
          Math.sin(2 * Math.PI * phase * t) * 1.0 +
          Math.sin(2 * Math.PI * phase * 2.01 * t) * 0.42 +
          Math.sin(2 * Math.PI * phase * 3.03 * t) * 0.22 +
          Math.sin(2 * Math.PI * phase * 4.07 * t) * 0.1;

        // 숨소리 성분
        sample += (random() - 0.5) * 0.12;
        const value = sample * envelope * amplitude * 0.32;
        if (cursor + index < out.length) out[cursor + index] = value;
      }
      sentencePosition += 1;
    }

    cursor += length;
    if (unit.terminal) {
      baseF0 = 118 + random() * 44;
      sentencePosition = 0;
    }
  }

  // 시작/끝 페이드 (클릭 방지)
  const fade = Math.min(Math.round(SAMPLE_RATE * 0.02), Math.floor(totalSamples / 8));
  for (let index = 0; index < fade; index += 1) {
    const factor = index / fade;
    out[index] = (out[index] ?? 0) * factor;
    out[totalSamples - 1 - index] = (out[totalSamples - 1 - index] ?? 0) * factor;
  }

  // 피크 정규화
  let peak = 0;
  for (let index = 0; index < out.length; index += 1) peak = Math.max(peak, Math.abs(out[index] ?? 0));
  if (peak > 0) {
    const gain = 0.72 / peak;
    for (let index = 0; index < out.length; index += 1) out[index] = (out[index] ?? 0) * gain;
  }

  return out;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
