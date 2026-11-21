import type { ContentDraft } from "@tae/ai";

export interface DraftCharacterCount {
  label: string;
  count: number;
  limit?: number;
  /** 표시 단위(기본 "자") */
  unit?: string;
}

/**
 * 페이스북 피드에 그대로 붙여 넣을 수 있는 글.
 * 헤드라인 → 스토리 본문 → 핵심 불릿 → 질문 → 해시태그 순서로 조립합니다.
 */
export function facebookFeedText(draft: Extract<ContentDraft, { format: "facebook" }>): string {
  const blocks = [
    draft.headline,
    draft.body,
    draft.bullets.map((bullet) => `• ${bullet}`).join("\n"),
    draft.closingQuestion,
    draft.hashtags.join(" "),
  ]
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.join("\n\n");
}

/** 피드 글의 실제 줄 수(빈 줄·해시태그 제외). "약 20줄" 표기에 사용합니다. */
export function facebookFeedLineCount(draft: Extract<ContentDraft, { format: "facebook" }>): number {
  return [draft.headline, draft.body, ...draft.bullets, draft.closingQuestion]
    .join("\n")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

/** 결과를 편집기·SNS에 붙여넣기 좋은 평문으로 직렬화합니다. */
export function draftToPlainText(draft: ContentDraft): string {
  switch (draft.format) {
    case "blog":
      return [
        draft.title,
        "",
        `요약: ${draft.metaDescription}`,
        `태그: ${draft.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}`,
        "",
        draft.executiveSummary ? `■ 한눈에 보는 요약\n${draft.executiveSummary}` : "",
        "",
        ...draft.outline.map((section) => `■ ${section.heading}\n${section.points.map((point) => `- ${point}`).join("\n")}`),
        "",
        draft.body,
        "",
        draft.keyTakeaways.length > 0 ? `■ 핵심 요약\n${draft.keyTakeaways.map((item) => `- ${item}`).join("\n")}` : "",
        "",
        draft.faq.length > 0 ? `■ 자주 묻는 질문\n${draft.faq.map((item) => `Q. ${item.question}\nA. ${item.answer}`).join("\n\n")}` : "",
      ]
        .filter((line, index, array) => !(line === "" && array[index - 1] === ""))
        .join("\n")
        .trim();

    case "instagram":
      return [
        draft.hook,
        "",
        `[카드뉴스 ${draft.slides.length}장]`,
        ...draft.slides.map((slide) => `${slide.index}. ${slide.title}\n   ${slide.body}`),
        "",
        "[캡션]",
        draft.caption,
        "",
        draft.cta,
        "",
        draft.hashtags.join(" "),
      ].join("\n");

    case "facebook":
      return facebookFeedText(draft);
  }
}

/** 블로그는 마크다운 파일로, SNS 글은 평문으로 저장합니다. */
export function draftToDownload(draft: ContentDraft): { content: string; fileName: string; mimeType: string } {
  if (draft.format === "blog") {
    return {
      content: [
        "---",
        `title: "${draft.title.replace(/"/g, '\\"')}"`,
        `description: "${draft.metaDescription.replace(/"/g, '\\"')}"`,
        `tags: [${draft.tags.map((tag) => `"${tag}"`).join(", ")}]`,
        "---",
        "",
        `# ${draft.title}`,
        "",
        "> " + draft.metaDescription,
        "",
        draft.executiveSummary ? `> **한눈에 보는 요약** — ${draft.executiveSummary}` : "",
        "",
        draft.body,
        "",
        "## 핵심 요약",
        ...draft.keyTakeaways.map((item) => `- ${item}`),
        draft.faq.length > 0 ? "\n## 자주 묻는 질문" : "",
        ...draft.faq.map((item) => `\n### ${item.question}\n${item.answer}`),
      ]
        .filter((line) => line !== "")
        .join("\n")
        .trim(),
      fileName: `${draft.slug}.md`,
      mimeType: "text/markdown;charset=utf-8",
    };
  }

  const prefix = draft.format === "instagram" ? "instagram" : "facebook";
  return {
    content: draftToPlainText(draft),
    fileName: `${prefix}-${new Date().toISOString().slice(0, 10)}.txt`,
    mimeType: "text/plain;charset=utf-8",
  };
}

export function draftHeadline(draft: ContentDraft): string {
  switch (draft.format) {
    case "blog":
      return draft.title;
    case "instagram":
      return draft.hook;
    case "facebook":
      return draft.headline;
  }
}

export function draftCharacterCounts(draft: ContentDraft): DraftCharacterCount[] {
  switch (draft.format) {
    case "blog":
      return [
        { label: "제목", count: draft.title.length },
        { label: "메타 설명", count: draft.metaDescription.length },
        { label: "본문", count: draft.body.length },
        { label: "FAQ", count: draft.faq.length, unit: "개" },
        { label: "태그", count: draft.tags.length, unit: "개" },
      ];
    case "instagram":
      return [
        { label: "캡션", count: draft.caption.length, limit: 2200 },
        { label: "카드", count: draft.slides.length, unit: "장" },
        { label: "해시태그", count: draft.hashtags.length, unit: "개" },
      ];
    case "facebook":
      return [
        { label: "줄 수", count: facebookFeedLineCount(draft), unit: "줄" },
        { label: "본문", count: draft.body.length },
      ];
  }
}
