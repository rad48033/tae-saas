import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeWav } from "./wav";
import type { GeneratedAudio, TtsProvider, TtsRequest, VideoLanguage } from "../types";

const SAMPLE_RATE = 24_000;

/**
 * 마지막 폴백: **음성 대신 배경 음악(앰비언트 베드)**.
 *
 * 이전 버전은 나레이션 음절을 흉내 낸 톤을 만들었는데, 위상 계산이 절대 시간에
 * 비례해 흔들려서 장면이 뒤로 갈수록 사이렌처럼 깨진 소리가 났습니다
 * ("ai음성도 다 깨지는데"). 사람 목소리를 흉내 내는 대신, 영상에는
 * 조용한 패드 + 문장 경계의 낮은 차임만 깔아 둡니다. 자막이 대사를 전달하고,
 * 결과에는 항상 `provider: "demo"`로 표시됩니다. 실제 음성은 GoogleTtsProvider
 * (키 없이 동작)나 OpenAI TTS가 담당합니다.
 */
export class DemoTtsProvider implements TtsProvider {
  readonly id = "demo" as const;
  readonly model = "demo-ambient-bed";

  async synthesize(request: TtsRequest): Promise<GeneratedAudio> {
    const durationMs = Math.max(1_000, Math.round(request.targetDurationMs));
    const samples = renderAmbientBed({
      text: request.text,
      durationMs,
      sceneIndex: request.sceneIndex,
      language: request.language,
    });
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

export interface AmbientBedInput {
  text: string;
  durationMs: number;
  sceneIndex: number;
  language: VideoLanguage;
}

/** 장면 배경 음. 길이는 정확히 durationMs입니다. */
export function renderAmbientBed(input: AmbientBedInput): Float32Array {
  const totalSamples = Math.max(1, Math.round((input.durationMs / 1000) * SAMPLE_RATE));
  const out = new Float32Array(totalSamples);
  const random = seededRandom(0x2545f491 ^ (input.sceneIndex * 2654435761));

  // 장면마다 조금씩 다른 조성을 씁니다(같은 음이 반복되지 않게).
  const roots = [146.83, 164.81, 130.81, 174.61, 196.0, 138.59];
  const root = roots[input.sceneIndex % roots.length] ?? 146.83;
  const chord = [1, 1.5, 2.0, 2.5];

  // ── 패드: 아주 느린 LFO로 부풀었다 줄어드는 저음 화음 ────────────────────
  const partials = chord.map((ratio, index) => ({
    frequency: root * ratio * (1 + (random() - 0.5) * 0.0015),
    amplitude: [0.32, 0.18, 0.1, 0.06][index] ?? 0.05,
    lfoRate: 0.045 + random() * 0.05,
    lfoPhase: random() * Math.PI * 2,
    phase: random() * Math.PI * 2,
  }));

  // ── 차임: 문장이 끝나는 지점(마침표·물음표)에 한 번씩 ────────────────────
  const chimeTimes = chimePositions(input.text, input.durationMs);

  // ── 바람 소리: 아주 약한 저역 노이즈(한 개의 1차 저역 통과 필터) ─────────
  let noiseState = 0;
  const noiseCut = 0.0016;

  for (let index = 0; index < totalSamples; index += 1) {
    const t = index / SAMPLE_RATE;
    let value = 0;

    for (const partial of partials) {
      const lfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * partial.lfoRate * t + partial.lfoPhase);
      partial.phase += (2 * Math.PI * partial.frequency) / SAMPLE_RATE;
      value += Math.sin(partial.phase) * partial.amplitude * lfo;
    }

    for (const start of chimeTimes) {
      const local = t - start;
      if (local < 0 || local > 2.2) continue;
      const decay = Math.exp(-local * 2.4);
      const bell =
        Math.sin(2 * Math.PI * root * 4 * local) * 0.55 +
        Math.sin(2 * Math.PI * root * 6 * local) * 0.25 +
        Math.sin(2 * Math.PI * root * 9 * local) * 0.12;
      value += bell * decay * 0.1;
    }

    noiseState += (((random() - 0.5) * 2 - noiseState) * noiseCut);
    value += noiseState * 0.5;

    out[index] = value;
  }

  applyEdgeFades(out, SAMPLE_RATE, 0.35);
  normalizePeak(out, 0.42);

  return out;
}

/** 마침표·물음표 뒤에 차임을 놓습니다(문장이 없으면 장면 시작에 한 번). */
function chimePositions(text: string, durationMs: number): number[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [0.4];

  const positions: number[] = [];
  let chars = 0;
  const total = Math.max(1, normalized.length);
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char && /[.!?。？！]/.test(char)) {
      positions.push(Math.min(durationMs / 1000 - 0.6, Math.max(0.4, (chars / total) * (durationMs / 1000))));
    }
    chars += 1;
  }

  if (positions.length === 0) return [0.4];
  // 너무 촘촘하면 소리가 뭉개지므로 1.2초 이상 벌립니다.
  const spaced: number[] = [];
  for (const position of positions) {
    const last = spaced.at(-1);
    if (last === undefined || position - last > 1.2) spaced.push(position);
  }
  return spaced.slice(0, 6);
}

function applyEdgeFades(samples: Float32Array, sampleRate: number, seconds: number): void {
  const fade = Math.min(Math.round(sampleRate * seconds), Math.floor(samples.length / 4));
  for (let index = 0; index < fade; index += 1) {
    const factor = index / fade;
    samples[index] = (samples[index] ?? 0) * factor;
    const tail = samples.length - 1 - index;
    samples[tail] = (samples[tail] ?? 0) * factor;
  }
}

function normalizePeak(samples: Float32Array, target: number): void {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  if (peak <= 0) return;
  const gain = target / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] ?? 0) * gain;
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
