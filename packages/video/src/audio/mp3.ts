/**
 * MP3 프레임 파서.
 *
 * OpenAI를 쓰지 않는 음성 대체(TTS)는 MP3로 오기 때문에, WAV 헤더처럼 길이를
 * 바로 읽을 수 없습니다. ffmpeg/ffprobe 없이도 장면 길이를 정확히 알아야
 * 자막 타이밍과 렌더 길이가 맞으므로 프레임을 직접 세어 길이를 구합니다.
 */

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44_100, 48_000, 32_000], // MPEG 1
  2: [22_050, 24_000, 16_000], // MPEG 2
  0: [11_025, 12_000, 8_000], // MPEG 2.5
};

export interface Mp3Info {
  sampleRate: number;
  /** MPEG1 = 1, MPEG2 = 2, MPEG2.5 = 2.5 */
  version: number;
  bitrateKbps: number;
  frames: number;
  durationMs: number;
}

/** 선두 ID3v2 태그를 건너뛴 오디오 시작 오프셋 */
export function audioStartOffset(buffer: Buffer): number {
  if (buffer.length < 10) return 0;
  if (buffer.toString("ascii", 0, 3) !== "ID3") return 0;

  const size =
    ((buffer[6] ?? 0) & 0x7f) * 0x200000 +
    ((buffer[7] ?? 0) & 0x7f) * 0x4000 +
    ((buffer[8] ?? 0) & 0x7f) * 0x80 +
    ((buffer[9] ?? 0) & 0x7f);

  // footer 플래그(0x10)가 있으면 10바이트가 더 붙습니다.
  const hasFooter = ((buffer[5] ?? 0) & 0x10) !== 0;
  return Math.min(buffer.length, 10 + size + (hasFooter ? 10 : 0));
}

/** ID3v2(앞)·ID3v1(뒤) 태그를 제거한 순수 프레임 바이트 */
export function stripMp3Tags(buffer: Buffer): Buffer {
  const start = audioStartOffset(buffer);
  let end = buffer.length;
  if (end - start >= 128 && buffer.toString("ascii", end - 128, end - 125) === "TAG") end -= 128;
  return buffer.subarray(start, Math.max(start, end));
}

/**
 * MP3 길이를 프레임 단위로 계산합니다. 파싱에 실패하면 null.
 * (Xing/Info 헤더 프레임은 소리가 없으므로 샘플 수에서 제외합니다.)
 */
export function readMp3Info(input: Buffer | Uint8Array): Mp3Info | null {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let offset = audioStartOffset(buffer);
  let sampleRate = 0;
  let version = 0;
  let bitrateKbps = 0;
  let frames = 0;
  let samples = 0;
  let first = true;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || ((buffer[offset + 1] ?? 0) & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const b1 = buffer[offset + 1] ?? 0;
    const b2 = buffer[offset + 2] ?? 0;

    const versionBits = (b1 >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
    const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    if (layerBits !== 1 || versionBits === 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const versionNumber = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const rate = SAMPLE_RATES[versionBits]?.[sampleRateIndex];
    const bitrate = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex];
    if (!rate || !bitrate) {
      offset += 1;
      continue;
    }

    const samplesPerFrame = versionBits === 3 ? 1_152 : 576;
    const frameLength = Math.floor((samplesPerFrame / 8) * ((bitrate * 1_000) / rate)) + padding;
    if (frameLength <= 4) {
      offset += 1;
      continue;
    }

    if (first) {
      sampleRate = rate;
      version = versionNumber;
      bitrateKbps = bitrate;
      first = false;
    }

    const body = buffer.subarray(offset, Math.min(offset + frameLength, buffer.length));
    const isHeaderFrame = body.includes("Xing") || body.includes("Info") || body.includes("VBRI");
    if (!isHeaderFrame) samples += samplesPerFrame;
    frames += 1;
    offset += frameLength;
  }

  if (!sampleRate || frames === 0) return null;

  return {
    sampleRate,
    version,
    bitrateKbps,
    frames,
    durationMs: Math.round((samples / sampleRate) * 1_000),
  };
}

export function mp3DurationMs(input: Buffer | Uint8Array): number | null {
  return readMp3Info(input)?.durationMs ?? null;
}

/** 같은 인코더로 만든 MP3 조각을 이어 붙입니다(앞 조각 외의 ID3 태그는 제거). */
export function concatMp3(chunks: Buffer[]): Buffer {
  const parts = chunks.filter((chunk) => chunk.length > 0).map((chunk) => stripMp3Tags(chunk));
  if (parts.length === 0) return Buffer.alloc(0);
  return Buffer.concat(parts);
}
