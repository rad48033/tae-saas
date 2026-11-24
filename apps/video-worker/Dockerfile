# ── 영상 렌더 워커 ────────────────────────────────────────────
# ffmpeg + 한글 폰트가 포함된 이미지로 빌드합니다.
# Railway / Fly.io / Cloud Run에서 이 Dockerfile을 그대로 사용하세요.
FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-cjk \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/youtube-blog/package.json apps/youtube-blog/
COPY apps/pdf-api/package.json apps/pdf-api/
COPY apps/video-worker/package.json apps/video-worker/
COPY packages/ai/package.json packages/ai/
COPY packages/db/package.json packages/db/
COPY packages/stripe/package.json packages/stripe/
COPY packages/video/package.json packages/video/

RUN pnpm install --frozen-lockfile --filter @tae/video-worker...

COPY packages ./packages
COPY apps/video-worker ./apps/video-worker
COPY tsconfig.base.json ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=192"
ENV PORT=8080
ENV VIDEO_OUTPUT_DIR=/data/video-jobs
ENV VIDEO_SUBTITLE_FONT="Noto Sans CJK KR"

RUN mkdir -p /data/video-jobs
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./apps/video-worker/node_modules/.bin/tsx", "apps/video-worker/src/server.ts"]
