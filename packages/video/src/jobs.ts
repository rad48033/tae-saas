import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AspectRatio, Storyboard } from "./types";

export type VideoJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface VideoJobRecord {
  id: string;
  status: VideoJobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  aspectRatio: AspectRatio;
  title: string;
  storyboard: Storyboard;
  quality: "preview" | "final";
  durationMs: number | null;
  files: {
    video: string | null;
    srt: string | null;
    ass: string | null;
    storyboard: string | null;
  };
  video: { bytes: number; durationSeconds: number; renderer: "ffmpeg" | "none" } | null;
  warnings: string[];
  error: string | null;
}

export interface CreateJobInput {
  storyboard: Storyboard;
  quality: "preview" | "final";
}

/**
 * 작업 상태를 파일로 남기는 최소 저장소.
 * 워커가 재시작해도 <jobDir>/job.json에서 진행 상태를 다시 읽습니다.
 */
export class VideoJobStore {
  private readonly jobs = new Map<string, VideoJobRecord>();

  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await this.read(entry.name);
      if (record) this.jobs.set(record.id, record);
    }
  }

  dirFor(id: string): string {
    return path.join(this.rootDir, id);
  }

  async create(input: CreateJobInput): Promise<VideoJobRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: VideoJobRecord = {
      id,
      status: "queued",
      stage: "대기",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      aspectRatio: input.storyboard.aspectRatio,
      title: input.storyboard.title,
      storyboard: input.storyboard,
      quality: input.quality,
      durationMs: null,
      files: { video: null, srt: null, ass: null, storyboard: null },
      video: null,
      warnings: [],
      error: null,
    };

    this.jobs.set(id, record);
    await mkdir(this.dirFor(id), { recursive: true });
    await this.persist(record);
    return record;
  }

  get(id: string): VideoJobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  list(limit = 20): VideoJobRecord[] {
    return [...this.jobs.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }

  async update(id: string, patch: Partial<VideoJobRecord>): Promise<VideoJobRecord | null> {
    const current = this.jobs.get(id);
    if (!current) return null;
    const next: VideoJobRecord = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, next);
    await this.persist(next);
    return next;
  }

  private async persist(record: VideoJobRecord): Promise<void> {
    await mkdir(this.dirFor(record.id), { recursive: true });
    await writeFile(path.join(this.dirFor(record.id), "job.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  private async read(id: string): Promise<VideoJobRecord | null> {
    try {
      const raw = await readFile(path.join(this.rootDir, id, "job.json"), "utf8");
      return JSON.parse(raw) as VideoJobRecord;
    } catch {
      return null;
    }
  }
}
