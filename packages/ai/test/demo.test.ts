import { describe, expect, it } from "vitest";

import { buildDemoContent } from "../src/demo/content";
import { createDemoAiService } from "../src/service";
import { contentSchemaForFormat } from "../src/schemas/content";

const FORMAT_SCHEMAS = {
  blog: contentSchemaForFormat("blog"),
  instagram: contentSchemaForFormat("instagram"),
  facebook: contentSchemaForFormat("facebook"),
};
import { pdfStructureSchemaIds, pdfStructureSchemas } from "../src/schemas/pdf";
import type { ContentGenerationInput } from "../src/prompts/youtube";

const baseInput: ContentGenerationInput = {
  video: {
    id: "abc123",
    url: "https://www.youtube.com/watch?v=abc123",
    title: "Next.js 15 캐시 완전 정리",
    channelTitle: "프론트엔드 채널",
  },
  transcript: {
    language: "ko",
    text: "Next.js 15에서는 fetch 캐시가 기본으로 꺼져 있습니다. 그래서 매 요청이 새로 실행됩니다. 캐시를 쓰려면 옵션을 명시해야 합니다. revalidate 옵션으로 주기를 정할 수 있습니다. 라우트 세그먼트 단위 캐시도 함께 이해해야 합니다. 배포 후에는 실제 응답 헤더로 캐시 상태를 확인하세요.",
    segments: [],
  },
  target: { language: "ko", format: "blog" },
};

describe("demo content generators", () => {
  it("produces a schema-valid blog draft", () => {
    const draft = contentSchemaForFormat("blog").parse(buildDemoContent(baseInput));
    expect(draft.format).toBe("blog");
    if (draft.format !== "blog") throw new Error("format mismatch");
    expect(draft.body.length).toBeGreaterThanOrEqual(300);
    expect(draft.outline.length).toBeGreaterThanOrEqual(2);
  });

  it("produces a card news draft with 5~7 slides and 15+ hashtags", () => {
    const draft = contentSchemaForFormat("instagram").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, format: "instagram" } }),
    );
    if (draft.format !== "instagram") throw new Error("format mismatch");
    expect(draft.slides.length).toBeGreaterThanOrEqual(5);
    expect(draft.slides.length).toBeLessThanOrEqual(7);
    expect(draft.hashtags.length).toBeGreaterThanOrEqual(15);
    expect(draft.hashtags.every((tag) => tag.startsWith("#"))).toBe(true);
    expect(draft.caption).toContain("저장");
  });

  it("produces a facebook post that ends with a question", () => {
    const draft = contentSchemaForFormat("facebook").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, format: "facebook" } }),
    );
    if (draft.format !== "facebook") throw new Error("format mismatch");
    expect(draft.closingQuestion.endsWith("?")).toBe(true);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(2);
    expect(draft.body.length).toBeGreaterThanOrEqual(200);
  });

  it("writes English copy for English targets", () => {
    const draft = contentSchemaForFormat("instagram").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, language: "en", format: "instagram" } }),
    );
    expect(draft.language).toBe("en");
    expect(draft.cta).toContain("Save");
  });
});

describe("createDemoAiService", () => {
  it("serves every format without an API key", async () => {
    const service = createDemoAiService();
    expect(service.mode).toBe("demo");

    for (const format of ["blog", "instagram", "facebook"] as const) {
      const result = await service.generateContent({ ...baseInput, target: { ...baseInput.target, format } });
      expect(result.provider).toBe("demo");
      expect(result.draft.format).toBe(format);
      expect(FORMAT_SCHEMAS[format].safeParse(result.draft).success).toBe(true);
    }
  });

  it("serves every PDF schema", async () => {
    const service = createDemoAiService();
    for (const schemaId of pdfStructureSchemaIds) {
      const result = await service.structurePdf({
        pages: [
          {
            page: 1,
            text: "INVOICE #2026-0042\nDate: 2026-03-14\nTotal 1,362.90\nBill to: Taest Labs",
          },
        ],
        schema: schemaId,
      });
      expect(pdfStructureSchemas[schemaId].safeParse(result.data).success).toBe(true);
    }
  });
});
