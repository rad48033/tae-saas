import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodePng } from "./png";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

/**
 * OPENAI_API_KEY가 없을 때 쓰는 결정적 이미지 생성기.
 * 장면 제목/번호에서 색과 구도를 뽑아 "영상 배경 카드"처럼 보이는 PNG를 만듭니다.
 * 외부 라이브러리·폰트·네트워크 없이 동작합니다.
 */
export class DemoImageProvider implements ImageProvider {
  readonly id = "demo" as const;
  readonly model = "demo-gradient";

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const { width, height } = request;
    const seed = hashString(`${request.scene.index}:${request.scene.title}:${request.scene.visualPrompt.slice(0, 64)}`);
    const rgb = renderFrame(width, height, seed, request.scene.index);

    const png = encodePng(width, height, rgb);
    await mkdir(path.dirname(request.outPath), { recursive: true });
    await writeFile(request.outPath, png);

    // 프롬프트는 나중에 같은 이미지를 재생성·교체할 수 있도록 옆에 남깁니다.
    await writeFile(`${request.outPath}.prompt.txt`, `${request.scene.visualPrompt}\n`, "utf8");

    return {
      sceneIndex: request.scene.index,
      path: request.outPath,
      width,
      height,
      provider: "demo",
      prompt: request.scene.visualPrompt,
    };
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** HSL(0..1 hue) → RGB(0..255) */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = (((hue % 1) + 1) % 1) * 6;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = lightness - chroma / 2;

  let rgb: [number, number, number];
  if (h < 1) rgb = [chroma, x, 0];
  else if (h < 2) rgb = [x, chroma, 0];
  else if (h < 3) rgb = [0, chroma, x];
  else if (h < 4) rgb = [0, x, chroma];
  else if (h < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

function renderFrame(width: number, height: number, seed: number, sceneIndex: number): Uint8Array {
  const buffer = Buffer.alloc(width * height * 3);

  const hue = ((seed % 360) / 360 + sceneIndex * 0.037) % 1;
  const accentHue = (hue + 0.12) % 1;

  const top = hslToRgb(hue, 0.42, 0.16);
  const bottom = hslToRgb((hue + 0.08) % 1, 0.55, 0.42);
  const glow = hslToRgb(accentHue, 0.7, 0.66);
  const accent = hslToRgb((hue + 0.5) % 1, 0.6, 0.55);

  const glowX = 0.28 + ((seed >>> 8) % 40) / 100;
  const glowY = 0.22 + ((seed >>> 16) % 30) / 100;
  const glowStrength = 0.22 + ((seed >>> 24) % 20) / 100;

  // 대각선 밴드의 기울기·위치를 시드로 고정합니다.
  const bandSlope = 0.55 + ((seed >>> 4) % 30) / 100;
  const bandCenter = 0.35 + ((seed >>> 12) % 30) / 100;

  // 상단의 추상 '타이포그래피' 블록(글자 대신 막대) 위치
  const ringCenterX = 0.62 + ((seed >>> 20) % 18) / 100;
  const ringCenterY = 0.34 + ((seed >>> 26) % 14) / 100;
  const ringRadius = 0.2 + ((seed >>> 10) % 12) / 100;

  const raw = buffer;
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    const ty = y / (height - 1);
    // 상단 → 하단 그라데이션 (중간을 약간 밝게)
    const mid = Math.min(1, Math.max(0, 1 - Math.abs(ty - 0.45) * 1.6));
    const rowBase = [
      top[0] + (bottom[0] - top[0]) * (ty * 0.85),
      top[1] + (bottom[1] - top[1]) * (ty * 0.85),
      top[2] + (bottom[2] - top[2]) * (ty * 0.85),
    ];
    const rowMid = mid * 0.18;
    const scrim = ty > 0.66 ? (ty - 0.66) / 0.34 : 0;
    const scrimFactor = 1 - 0.62 * scrim * scrim;
    const vignetteY = Math.abs(ty - 0.5) * 2;

    for (let x = 0; x < width; x += 1) {
      const tx = x / (width - 1);

      let r = rowBase[0] ?? 0;
      let g = rowBase[1] ?? 0;
      let b = rowBase[2] ?? 0;

      // 중앙 하이라이트
      r += (255 - r) * rowMid * 0.35;
      g += (255 - g) * rowMid * 0.35;
      b += (255 - b) * rowMid * 0.35;

      // 부드러운 글로우
      const dx = (tx - glowX) * (width / height);
      const dy = ty - glowY;
      const glowFalloff = 1 - Math.min(1, (dx * dx + dy * dy) * 3.2);
      if (glowFalloff > 0) {
        const strength = glowFalloff * glowFalloff * glowStrength;
        r += (glow[0] - r) * strength;
        g += (glow[1] - g) * strength;
        b += (glow[2] - b) * strength;
      }

      // 대각선 밴드
      const diagonal = tx * bandSlope + ty * (1 - bandSlope);
      const band = 1 - Math.min(1, Math.abs(diagonal - bandCenter) * 9);
      if (band > 0) {
        const strength = band * band * 0.16;
        r += (accent[0] - r) * strength;
        g += (accent[1] - g) * strength;
        b += (accent[2] - b) * strength;
      }

      // 큰 원형 라인 (장면마다 위치가 달라집니다)
      const ringDx = tx - ringCenterX;
      const ringDy = ty - ringCenterY;
      const ringDistance = Math.sqrt(ringDx * ringDx * (width / height) + ringDy * ringDy);
      const ringEdge = Math.abs(ringDistance - ringRadius);
      if (ringEdge < 0.004) {
        const strength = (1 - ringEdge / 0.004) * 0.12;
        r += (255 - r) * strength;
        g += (255 - g) * strength;
        b += (255 - b) * strength;
      }

      // 비네팅
      const vignette = 1 - 0.28 * Math.min(1, Math.abs(tx - 0.5) * 1.6 + vignetteY * 0.5);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      // 하단 자막 스크림
      r *= scrimFactor;
      g *= scrimFactor;
      b *= scrimFactor;

      raw[offset] = Math.max(0, Math.min(255, Math.round(r)));
      raw[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      offset += 3;
    }
  }

  // 좌상단 장면 번호 배지 (작은 사각형)
  const badgeSize = Math.round(Math.min(width, height) * 0.055);
  const badgeX = Math.round(width * 0.08);
  const badgeY = Math.round(height * 0.08);
  paintRect(raw, width, height, badgeX, badgeY, badgeSize, badgeSize, [255, 255, 255], 0.16);
  paintRect(
    raw,
    width,
    height,
    badgeX + Math.round(badgeSize * 0.18),
    badgeY + Math.round(badgeSize * 0.18),
    badgeSize - Math.round(badgeSize * 0.36),
    Math.max(2, Math.round(badgeSize * 0.12)),
    [255, 255, 255],
    0.5,
  );

  // 장면마다 다른 강조선 하나
  paintRect(
    raw,
    width,
    height,
    Math.round(width * 0.08),
    Math.round(height * 0.86),
    Math.round(width * 0.2),
    Math.max(3, Math.round(height * 0.005)),
    [255, 255, 255],
    0.32,
  );

  // 큰 장면 번호(7세그먼트 숫자). 빈 그라데이션이 아니라 "디자인된 카드"로 보이게 합니다.
  const digitSize = Math.round(Math.min(width, height) * 0.33);
  const digitX = Math.round(width * 0.5);
  const digitY = Math.round(height * 0.3);
  paintSceneNumber(raw, width, height, digitX, digitY, digitSize, sceneIndex + 1, 0.18);

  // 모서리 프레임(얇은 네 귀퉁이 선)
  paintCornerFrame(raw, width, height, Math.round(Math.min(width, height) * 0.06), Math.round(Math.min(width, height) * 0.055), [255, 255, 255], 0.22);

  // 미세한 필름 그레인
  paintGrain(raw, width, height, seed);

  return raw;
}

/** 1~2자리 장면 번호를 7세그먼트 막대로 그립니다(폰트 없이 숫자를 그리는 방법). */
const SEGMENTS: Record<number, string> = {
  0: "abcdef",
  1: "bc",
  2: "abged",
  3: "abgcd",
  4: "fgbc",
  5: "afgcd",
  6: "afgedc",
  7: "abc",
  8: "abcdefg",
  9: "abfgcd",
};

function paintSceneNumber(
  buffer: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  size: number,
  value: number,
  alpha: number,
): void {
  const text = String(Math.max(1, Math.min(99, value))).padStart(2, "0");
  const thickness = Math.max(6, Math.round(size * 0.16));
  const digitWidth = Math.round(size * 0.58);
  const gap = Math.round(size * 0.22);
  const totalWidth = text.length * digitWidth + (text.length - 1) * gap;

  text.split("").forEach((char, index) => {
    const digit = Number(char);
    const segments = SEGMENTS[digit] ?? "";
    const originX = x - Math.round(totalWidth / 2) + index * (digitWidth + gap);
    const originY = y;
    const midY = originY + Math.round(size / 2) - Math.round(thickness / 2);
    const bottomY = originY + size - thickness;
    const halfHeight = Math.round(size / 2) - thickness;

    const draw = (sx: number, sy: number, sw: number, sh: number) =>
      paintRect(buffer, width, height, sx, sy, sw, sh, [255, 255, 255], alpha);

    if (segments.includes("a")) draw(originX + thickness, originY, digitWidth - thickness * 2, thickness);
    if (segments.includes("b")) draw(originX + digitWidth - thickness, originY + thickness, thickness, halfHeight);
    if (segments.includes("c")) draw(originX + digitWidth - thickness, midY + thickness, thickness, halfHeight);
    if (segments.includes("d")) draw(originX + thickness, bottomY, digitWidth - thickness * 2, thickness);
    if (segments.includes("e")) draw(originX, midY + thickness, thickness, halfHeight);
    if (segments.includes("f")) draw(originX, originY + thickness, thickness, halfHeight);
    if (segments.includes("g")) draw(originX + thickness, midY, digitWidth - thickness * 2, thickness);
  });
}

/** 네 모서리에만 짧은 선을 그립니다. */
function paintCornerFrame(
  buffer: Uint8Array,
  width: number,
  height: number,
  margin: number,
  length: number,
  color: [number, number, number],
  alpha: number,
): void {
  const thickness = Math.max(2, Math.round(Math.min(width, height) * 0.0025));
  const corners: [number, number, number, number][] = [
    [margin, margin, length, thickness],
    [margin, margin, thickness, length],
    [width - margin - length, margin, length, thickness],
    [width - margin - thickness, margin, thickness, length],
    [margin, height - margin - thickness, length, thickness],
    [margin, height - margin - length, thickness, length],
    [width - margin - length, height - margin - thickness, length, thickness],
    [width - margin - thickness, height - margin - length, thickness, length],
  ];

  for (const [x, y, w, h] of corners) paintRect(buffer, width, height, x, y, w, h, color, alpha);
}

/** 결정적 필름 그레인(밋밋한 그라데이션을 사진처럼 보이게). */
function paintGrain(buffer: Uint8Array, width: number, height: number, seed: number): void {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const step = 2;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const noise = (next() - 0.5) * 10;
      const offset = (y * width + x) * 3;
      const base = buffer[offset] ?? 0;
      const value = Math.max(0, Math.min(255, Math.round(base + noise)));
      buffer[offset] = value;
      buffer[offset + 1] = Math.max(0, Math.min(255, Math.round((buffer[offset + 1] ?? 0) + noise)));
      buffer[offset + 2] = Math.max(0, Math.min(255, Math.round((buffer[offset + 2] ?? 0) + noise)));
    }
  }
}

function paintRect(
  buffer: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  alpha: number,
): void {
  for (let py = y; py < y + h; py += 1) {
    if (py < 0 || py >= height) continue;
    for (let px = x; px < x + w; px += 1) {
      if (px < 0 || px >= width) continue;
      const offset = (py * width + px) * 3;
      buffer[offset] = Math.round((buffer[offset] ?? 0) * (1 - alpha) + color[0] * alpha);
      buffer[offset + 1] = Math.round((buffer[offset + 1] ?? 0) * (1 - alpha) + color[1] * alpha);
      buffer[offset + 2] = Math.round((buffer[offset + 2] ?? 0) * (1 - alpha) + color[2] * alpha);
    }
  }
}
