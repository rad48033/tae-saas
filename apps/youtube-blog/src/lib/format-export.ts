import type { ContentDraft } from "@tae/ai";

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
        ...draft.outline.map((section) => `■ ${section.heading}\n${section.points.map((point) => `- ${point}`).join("\n")}`),
        "",
        draft.body,
        "",
        draft.keyTakeaways.length > 0 ? `핵심 요약\n${draft.keyTakeaways.map((item) => `- ${item}`).join("\n")}` : "",
      ]
        .filter((line, index, array) => !(line === "" && array[index - 1] === ""))
        .join("\n")
        .trim();

    case "instagram":
      return [
        draft.hook,
        "",
        "[카드뉴스]",
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
      return [
        draft.headline,
        "",
        draft.body,
        "",
        "[핵심]",
        ...draft.bullets.map((bullet) => `- ${bullet}`),
        "",
        draft.closingQuestion,
        draft.hashtags.length > 0 ? `\n${draft.hashtags.join(" ")}` : "",
      ]
        .join("\n")
        .trim();
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

export function draftCharacterCounts(draft: ContentDraft): { label: string; count: number; limit?: number }[] {
  switch (draft.format) {
    case "blog":
      return [
        { label: "제목", count: draft.title.length },
        { label: "메타 설명", count: draft.metaDescription.length },
      ];
    case "instagram":
      return [{ label: "캡션", count: draft.caption.length, limit: 2200 }];
    case "facebook":
      return [{ label: "본문", count: draft.body.length }];
  }
}
