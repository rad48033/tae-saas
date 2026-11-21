import type { AspectPreset, SttProvider, SttRequest, SttResult, SubtitleCue } from "../types";
import { aspectPreset } from "../aspect";
import { alignCueTimings, splitNarrationIntoChunks } from "../subtitles";

/**
 * STT 없이 만드는 결정적 자막 정렬.
 * 나레이션 문장을 자막 컷으로 나누고, 실제 오디오 길이에 글자 수 비례로 배분합니다.
 * 데모 TTS는 목표 길이에 정확히 맞춰 생성되므로 자막과 음성이 어긋나지 않습니다.
 */
export class AlignedSttProvider implements SttProvider {
  readonly id = "fallback" as const;
  readonly model = "deterministic-alignment";

  async transcribe(request: SttRequest): Promise<SttResult> {
    const preset = aspectPreset(request.aspectRatio);
    const cues = alignedCues(request, preset);
    return { cues, provider: "fallback", warnings: [] };
  }
}

export function alignedCues(request: SttRequest, preset: AspectPreset): SubtitleCue[] {
  const chunks = splitNarrationIntoChunks(request.narration, preset.subtitle.maxCharsPerCue);
  if (chunks.length === 0) return [];
  const cues = alignCueTimings(chunks, request.startMs, Math.max(600, request.durationMs));
  // 마지막 컷이 오디오 끝을 넘지 않게 잘라 줍니다.
  const end = request.startMs + request.durationMs;
  return cues.map((cue) => ({ ...cue, endMs: Math.min(cue.endMs, end) }));
}
