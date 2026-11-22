import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  isPrivateHost,
  resolveReferenceImages,
  summarizeReferences,
  toStoryboardReferenceList,
  toStoryboardReferences,
} from "../src/references";

/** 1x1 PNG (실제 이미지 시그니처 포함) */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tae-ref-"));
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("resolveReferenceImages", () => {
  it("reads a local file and keeps label/role/hash", async () => {
    const file = path.join(workDir, "box-front.png");
    await writeFile(file, PNG_BYTES);

    const { images, errors } = await resolveReferenceImages([
      { path: file, label: "제품 박스 정면", role: "product" },
    ]);

    expect(errors).toEqual([]);
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(images[0]?.label).toBe("제품 박스 정면");
    expect(images[0]?.role).toBe("product");
    expect(images[0]?.sha256).toBe(createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 10));
    expect(images[0]?.filename).toBe("reference-01.png");
  });

  it("decodes a data URL and defaults the role to product", async () => {
    const { images } = await resolveReferenceImages([
      { data: `data:image/png;base64,${PNG_BASE64}`, label: "붙여넣은 사진" },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]?.role).toBe("product");
    expect(images[0]?.mimeType).toBe("image/png");
    expect(images[0]?.origin).toBe("inline:base64");
  });

  it("drops duplicate photos and reports unreadable entries without failing", async () => {
    const file = path.join(workDir, "dup.png");
    await writeFile(file, PNG_BYTES);

    const { images, errors } = await resolveReferenceImages([
      { path: file, label: "A" },
      { data: `data:image/png;base64,${PNG_BASE64}`, label: "같은 사진" },
      { path: path.join(workDir, "없는파일.png") },
    ]);

    expect(images).toHaveLength(1);
    expect(errors.join(" ")).toContain("읽지 못했습니다");
  });

  it("refuses private-network URLs and non-image content", async () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.0.5")).toBe(true);
    expect(isPrivateHost("cdn.instagram.com")).toBe(false);

    const { images, errors } = await resolveReferenceImages([{ url: "http://127.0.0.1:8080/ref.jpg" }]);
    expect(images).toHaveLength(0);
    expect(errors[0]).toContain("사설망");
  });

  it("caps the number of reference photos", async () => {
    const inputs = Array.from({ length: 9 }, (_, index) => ({
      data: `data:image/png;base64,${PNG_BASE64}`,
      label: `사진 ${index + 1}`,
    }));
    // 같은 바이트는 중복으로 걸러지므로 1장만 남는지도 함께 확인합니다.
    const { images, errors } = await resolveReferenceImages(inputs, { maxImages: 2 });
    expect(images).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("storyboard reference projection", () => {
  it("keeps only URLs for the storyboard JSON", async () => {
    const file = path.join(workDir, "local.png");
    await writeFile(file, Buffer.concat([PNG_BYTES, Buffer.from([0])]));

    const list = toStoryboardReferenceList([
      { url: "https://cdn.example.com/a.jpg", label: "제품 박스", role: "product" },
      { path: file, label: "로컬 사진" },
    ]);

    expect(list[0]).toEqual({ url: "https://cdn.example.com/a.jpg", label: "제품 박스", role: "product" });
    expect(list[1]).toEqual({ label: "로컬 사진", role: "product" });
  });

  it("summarizes resolved references for the manifest", async () => {
    const file = path.join(workDir, "summary.png");
    await writeFile(file, Buffer.concat([PNG_BYTES, Buffer.from([1, 2])]));
    const { images } = await resolveReferenceImages([{ path: file, label: "제품 실사용" }]);

    expect(summarizeReferences(images)).toEqual({
      count: 1,
      labels: ["제품 실사용"],
      roles: ["product"],
    });
    expect(summarizeReferences([])).toBeUndefined();
    expect(toStoryboardReferences(images)[0]?.label).toBe("제품 실사용");
  });
});
