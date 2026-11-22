/**
 * taest 앱 아이콘 생성기.
 *
 * 외부 이미지 라이브러리 없이 순수 Node(zlib)로 PNG를 직접 인코딩합니다.
 * 브랜드 색(인디고 #6366f1 → #4338ca) 라운드 사각형 위에 흰색 소문자 "t" 마크를 그립니다.
 *
 * 실행: node scripts/generate-icons.mjs
 * 산출: public/icons/*.png, public/favicon.svg, src/app/icon.png
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = path.join(appDir, "public", "icons");

const BRAND_FROM = [99, 102, 241]; // #6366f1
const BRAND_TO = [67, 56, 202]; // #4338ca
const INK = [15, 23, 42]; // #0f172a

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));

/** 라운드 사각형까지의 부호 있는 거리(픽셀 단위). 음수면 내부. */
function roundedRectDistance(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x - cx) - (halfWidth - radius);
  const dy = Math.abs(y - cy) - (halfHeight - radius);
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy) - radius;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) - radius;
}

/** 거리 값을 1px 폭 안티에일리어싱 커버리지(0~1)로 바꿉니다. */
const coverage = (distance) => clamp01(0.5 - distance);

/**
 * 아이콘 한 장을 RGBA 버퍼로 그립니다.
 * @param {number} size
 * @param {{ maskable?: boolean, opaqueBackground?: boolean }} options
 */
function renderIcon(size, options = {}) {
  const { maskable = false, opaqueBackground = false } = options;
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  // maskable 아이콘은 안전 영역(중앙 80% 원) 안에 마크가 들어가야 합니다.
  const outerRadius = maskable ? size / 2 : size * 0.22;
  // 일반 아이콘은 마크를 조금 크게, maskable은 안전 영역에 맞춰 줄입니다.
  const markScale = maskable ? 0.62 : 0.74;
  const markWidth = size * markScale;
  const markCenter = center;
  const markTop = center - markWidth / 2;

  // "t": 세로 기둥 + 위쪽 가로획
  const stemHalfWidth = markWidth * 0.095;
  const stemTop = markTop + markWidth * 0.12;
  const stemBottom = markTop + markWidth * 0.97;
  const crossHalfWidth = markWidth * 0.3;
  const crossTop = markTop + markWidth * 0.27;
  const crossHeight = markWidth * 0.15;
  const stemRadius = stemHalfWidth * 0.85;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const index = (y * size + x) * 4;

      // 배경: 대각선 그라디언트 + 좌상단 하이라이트
      const t = clamp01((px / size) * 0.55 + (py / size) * 0.45);
      let base = mix(BRAND_FROM, BRAND_TO, t);
      const glowDistance = Math.hypot(px - size * 0.28, py - size * 0.2) / (size * 0.75);
      const glow = clamp01(1 - glowDistance) ** 2 * 0.35;
      base = mix(base, [255, 255, 255], glow);

      const backgroundCoverage = opaqueBackground
        ? 1
        : coverage(roundedRectDistance(px, py, center, center, center, center, outerRadius));

      if (backgroundCoverage <= 0) {
        pixels[index] = 0;
        pixels[index + 1] = 0;
        pixels[index + 2] = 0;
        pixels[index + 3] = 0;
        continue;
      }

      // 흰색 "t" 마크: 두 도형 중 가까운 커버리지를 사용합니다.
      const stem = coverage(
        roundedRectDistance(px, py, markCenter, (stemTop + stemBottom) / 2, stemHalfWidth, (stemBottom - stemTop) / 2, stemRadius),
      );
      const cross = coverage(
        roundedRectDistance(px, py, markCenter, crossTop + crossHeight / 2, crossHalfWidth, crossHeight / 2, crossHeight / 2),
      );
      const markCoverage = Math.min(1, Math.max(stem, cross));

      // 흰색 마크를 배경 위에 합성합니다.
      const color = mix(base, [255, 255, 255], markCoverage);

      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = Math.round(255 * backgroundCoverage);
    }
  }

  return pixels;
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA 버퍼를 PNG 파일 바이트로 인코딩합니다. */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // 각 행 앞에 필터 타입 0(없음)을 붙입니다.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-192.png", size: 192, maskable: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, opaqueBackground: true },
  { file: "icon-1024.png", size: 1024, opaqueBackground: true },
];

export async function generateIcons() {
  await mkdir(iconDir, { recursive: true });
  const written = [];
  for (const target of TARGETS) {
    const png = encodePng(target.size, renderIcon(target.size, target));
    const filePath = path.join(iconDir, target.file);
    await writeFile(filePath, png);
    written.push(filePath);
  }

  // Next.js app 디렉터리 아이콘(파비콘·앱 아이콘 자동 링크)
  const appIcon = path.join(appDir, "src", "app", "icon.png");
  await writeFile(appIcon, encodePng(256, renderIcon(256, { opaqueBackground: true })));
  written.push(appIcon);

  // 벡터 파비콘
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="taest">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <path d="M27 15h9v9h12v8H36v13a4 4 0 0 0 4 4h5v8h-7c-7 0-11-4-11-11V32h-6v-8h6z" fill="#fff"/>
</svg>
`;
  const faviconPath = path.join(appDir, "public", "favicon.svg");
  await writeFile(faviconPath, favicon);
  written.push(faviconPath);

  return written;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  generateIcons()
    .then((files) => {
      for (const file of files) console.log(`✔ ${path.relative(appDir, file)}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
