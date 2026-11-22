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
import type { ContentGenerationInput } from "../src/prompts/content";

const baseSource = {
  sourceType: "youtube" as const,
  id: "abc123",
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Next.js 15 캐시 완전 정리",
  author: "프론트엔드 채널",
  language: "ko" as const,
  text: "Next.js 15에서는 fetch 캐시가 기본으로 꺼져 있습니다. 그래서 매 요청이 새로 실행됩니다. 캐시를 쓰려면 옵션을 명시해야 합니다. revalidate 옵션으로 주기를 정할 수 있습니다. 라우트 세그먼트 단위 캐시도 함께 이해해야 합니다. 배포 후에는 실제 응답 헤더로 캐시 상태를 확인하세요.",
  segments: [],
};

const baseInput: ContentGenerationInput = {
  source: baseSource,
  target: { language: "ko", format: "blog" },
};

describe("demo content generators", () => {
  it("produces a schema-valid influencer-grade blog draft", () => {
    const draft = contentSchemaForFormat("blog").parse(buildDemoContent(baseInput));
    expect(draft.format).toBe("blog");
    if (draft.format !== "blog") throw new Error("format mismatch");
    // 인플루언서급 장문 기준: 본문 2,000자 이상, H2 4~5개, FAQ 3개 이상, 태그 8~10개
    expect(draft.body.length).toBeGreaterThanOrEqual(2000);
    expect(draft.outline.length).toBeGreaterThanOrEqual(4);
    expect(draft.outline.length).toBeLessThanOrEqual(5);
    expect(draft.faq.length).toBeGreaterThanOrEqual(3);
    expect(draft.tags.length).toBeGreaterThanOrEqual(8);
    expect(draft.tags.length).toBeLessThanOrEqual(10);
    expect(draft.executiveSummary.length).toBeGreaterThan(60);
    expect(draft.keyTakeaways.length).toBeGreaterThanOrEqual(3);
    // 본문의 H2가 목차와 같은 순서로 들어갑니다.
    const bodyHeadings = [...draft.body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(bodyHeadings).toEqual(draft.outline.map((section) => section.heading));
  });

  it("produces a 10-slide carousel with roles, long caption and 15~20 hashtags", () => {
    const draft = contentSchemaForFormat("instagram").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, format: "instagram" } }),
    );
    if (draft.format !== "instagram") throw new Error("format mismatch");
    expect(draft.slides).toHaveLength(10);
    expect(draft.slides.map((slide) => slide.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(draft.slides[0]?.role).toBe("cover");
    expect(draft.slides.slice(1, 8).every((slide) => slide.role === "point")).toBe(true);
    expect(draft.slides[8]?.role).toBe("caveat");
    expect(draft.slides[9]?.role).toBe("summary");
    expect(draft.hashtags.length).toBeGreaterThanOrEqual(15);
    expect(draft.hashtags.length).toBeLessThanOrEqual(20);
    expect(draft.hashtags.every((tag) => tag.startsWith("#"))).toBe(true);
    // 캡션은 여러 문단(빈 줄로 구분)이고 700자 이상입니다.
    expect(draft.caption.length).toBeGreaterThanOrEqual(700);
    expect(draft.caption.split("\n\n").length).toBeGreaterThanOrEqual(4);
    expect(draft.caption).toContain("저장");
  });

  it("produces a ~20-line facebook post that ends with a question", () => {
    const draft = contentSchemaForFormat("facebook").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, format: "facebook" } }),
    );
    if (draft.format !== "facebook") throw new Error("format mismatch");
    expect(draft.closingQuestion.endsWith("?")).toBe(true);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(4);
    expect(draft.bullets.length).toBeLessThanOrEqual(6);

    // 헤드라인 + 본문 줄 + 불릿 + 질문 = 약 20줄
    const totalLines =
      1 +
      draft.body.split("\n").filter((line) => line.trim().length > 0).length +
      draft.bullets.length +
      1;
    expect(totalLines).toBeGreaterThanOrEqual(18);
    expect(totalLines).toBeLessThanOrEqual(22);
  });

  it("writes English copy for English targets", () => {
    const draft = contentSchemaForFormat("instagram").parse(
      buildDemoContent({ ...baseInput, target: { ...baseInput.target, language: "en", format: "instagram" } }),
    );
    expect(draft.language).toBe("en");
    expect(draft.cta).toContain("Save");
  });
});

describe("omni-channel demo generators", () => {
  const blogSource = {
    ...baseSource,
    sourceType: "blog" as const,
    id: "blog-1",
    url: "https://example.com/blog/cache",
    title: "캐시를 이해하면 배포가 달라집니다",
    author: "운영 노트",
  };
  const instagramSource = {
    ...baseSource,
    sourceType: "instagram" as const,
    id: "ig-1",
    url: "https://www.instagram.com/p/abc/",
    title: "캐시 3줄 정리",
    author: "@cache.daily",
  };

  for (const [label, source] of [
    ["blog", blogSource],
    ["instagram", instagramSource],
  ] as const) {
    it(`writes every text output from a ${label} source in that source's own words`, () => {
      for (const format of ["blog", "instagram", "facebook"] as const) {
        const draft = FORMAT_SCHEMAS[format].parse(
          buildDemoContent({ source, target: { language: "ko", format } }),
        );
        expect(draft.format).toBe(format);

        const serialized = JSON.stringify(draft);
        expect(serialized).not.toContain("자막");
        expect(serialized).not.toContain("영상");
      }
    });
  }
});

describe("robustness of demo generators (regressions)", () => {
  // 문장부호 없이 400자 넘는 원문 → outline points가 300자 상한을 넘어 ZodError로 500이 났습니다.
  const longText = "가".repeat(520);
  const longSource = { ...baseSource, sourceType: "instagram" as const, text: longText, title: "긴 캡션 테스트입니다" };

  for (const format of ["blog", "instagram", "facebook"] as const) {
    it(`keeps a ${format} draft schema-valid when the source has no punctuation`, () => {
      const draft = FORMAT_SCHEMAS[format].parse(
        buildDemoContent({ source: longSource, target: { language: "ko", format } }),
      );
      expect(draft.format).toBe(format);
      if (draft.format === "blog") {
        for (const section of draft.outline) {
          for (const point of section.points) expect(point.length).toBeLessThanOrEqual(300);
        }
      }
    });
  }

  it("splits comma-joined hashtags and drops hashtags from quoted captions", async () => {
    const service = createDemoAiService();
    const result = await service.generateContent({
      source: {
        ...longSource,
        text: "#협찬 #을뜨뜨서포터즈 | 악토프리미엄\n아이도 거부감 없이 먹는 요구르트맛 유산균🩵 하루면 충분해요.\n🏷️ #을뜨뜨악토프리미엄,온가족 #아기유산균",
      },
      target: { language: "ko", format: "instagram" },
    });

    if (result.draft.format !== "instagram") throw new Error("format mismatch");
    expect(result.draft.hashtags.every((tag) => !/[,|\s]/.test(tag))).toBe(true);
    expect(result.draft.hashtags).toContain("#온가족");
    expect(result.draft.caption).not.toContain("#협찬");
    expect(result.draft.caption).not.toMatch(/[🩵🏷️]/u);
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
