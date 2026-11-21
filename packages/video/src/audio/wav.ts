/**
 * WAV(RIFF/PCM) 최소 구현.
 * 데모 음성 생성기는 이 인코더로 실제 재생 가능한 WAV를 만들고,
 * OpenAI TTS도 `response_format: "wav"`로 받아 길이를 직접 읽습니다.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  dataBytes: number;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  return buffer;
}

export function readWavInfo(input: Buffer | Uint8Array): WavInfo | null {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt " && body + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    }
    if (id === "data") {
      dataBytes = Math.min(size, Math.max(0, buffer.length - body));
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!sampleRate || !channels) return null;
  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationMs: bytesPerSecond > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0,
  };
}

export function wavDurationMs(input: Buffer | Uint8Array): number | null {
  return readWavInfo(input)?.durationMs ?? null;
}
