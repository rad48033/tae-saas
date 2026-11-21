import type { ContentGenerationInput } from "../prompts/youtube";
import type { BlogDraft, ContentDraft, FacebookDraft, InstagramDraft } from "../schemas/content";
import { clampText, countWords } from "../text";
import { normalizeSlug } from "../services/content";

/**
 * ANTHROPIC_API_KEY 없이 로컬에서 전체 흐름을 확인하기 위한 결정적 생성기.
 * 결과에는 항상 provider: "demo"가 붙고 UI에서 데모 모드로 표시됩니다.
 */
export function buildDemoContent(input: ContentGenerationInput): ContentDraft {
  switch (input.target.format) {
    case "blog":
      return buildDemoBlog(input);
    case "instagram":
      return buildDemoInstagram(input);
    case "facebook":
      return buildDemoFacebook(input);
  }
}

export function buildDemoBlog(input: ContentGenerationInput): BlogDraft {
  const { video, transcript, target } = input;
  const sentences = splitSentences(transcript.text).filter((sentence) => sentence.length > 8);
  const isKorean = target.language === "ko";

  const keyPoints = pickEvenly(sentences, 6);
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const title = isKorean
    ? clampText(`${video.title} 핵심 정리: ${keyword}편`, 70)
    : clampText(`${video.title} — key takeaways on ${keyword}`, 80);

  const sections = isKorean
    ? [
        { heading: "한눈에 보는 요약", points: keyPoints.slice(0, 2) },
        { heading: "영상에서 다룬 핵심 포인트", points: keyPoints.slice(0, 5) },
        {
          heading: "실제로 적용하는 방법",
          points: keyPoints
            .slice(2, 6)
            .map((point) => `${point} → 이 부분을 내 상황에 맞게 한 줄로 바꿔 실행 계획에 적어 두세요.`),
        },
        { heading: "정리", points: [`${video.channelTitle} 채널의 영상 "${video.title}"을 자막 기준으로 정리한 글입니다.`] },
      ]
    : [
        { heading: "Summary", points: keyPoints.slice(0, 2) },
        { heading: "Key points from the video", points: keyPoints.slice(0, 5) },
        { heading: "How to apply it", points: keyPoints.slice(2, 6) },
        { heading: "Final thoughts", points: [`Based on the transcript of "${video.title}" by ${video.channelTitle}.`] },
      ];

  const intro = isKorean
    ? `${video.channelTitle}의 "${video.title}" 영상을 자막 기준으로 정리했습니다. 이 글은 ${target.audience ?? "영상의 핵심을 빠르게 파악하려는 분"}을 위해, 영상에서 실제로 언급된 내용만 골라 블로그 형식으로 재구성했습니다.`
    : `This post condenses "${video.title}" by ${video.channelTitle}, using only what the transcript actually covers.`;

  const demoNote = isKorean
    ? "> 데모 모드에서 생성된 초안입니다. ANTHROPIC_API_KEY를 설정하면 Claude가 문장과 구조를 다듬은 결과를 받습니다."
    : "> Draft generated in demo mode. Set ANTHROPIC_API_KEY to have Claude rewrite and structure the post.";

  const body = [
    intro,
    ...sections.map((section) => `## ${section.heading}\n\n${section.points.map((point) => `- ${point}`).join("\n")}`),
    demoNote,
  ].join("\n\n");

  return {
    format: "blog",
    language: target.language,
    title,
    slug: normalizeSlug(undefined, `${keyword} ${video.id}`),
    metaDescription: isKorean
      ? clampText(`${video.title} 영상의 핵심을 자막 근거로 정리했습니다. ${keyPoints[0] ?? ""}`.trim(), 150)
      : clampText(`Key takeaways from ${video.title}, summarized from the transcript. ${keyPoints[0] ?? ""}`.trim(), 150),
    primaryKeyword: keyword,
    secondaryKeywords: isKorean ? ["영상 요약", "핵심 정리"] : ["video summary", "key takeaways"],
    outline: sections,
    body,
    keyTakeaways: keyPoints.slice(0, 3),
    faq: isKorean
      ? [
          {
            question: `${video.title} 영상의 핵심은 무엇인가요?`,
            answer: keyPoints[0] ?? "자막에서 확인된 내용을 위 본문에 정리했습니다.",
          },
        ]
      : [
          {
            question: `What is the main point of ${video.title}?`,
            answer: keyPoints[0] ?? "See the key points section above.",
          },
        ],
    tags: isKorean
      ? ["유튜브요약", keyword, video.channelTitle].filter(Boolean)
      : ["youtube summary", keyword, video.channelTitle].filter(Boolean),
    readingTimeMinutes: Math.max(1, Math.ceil(countWords(body) / 500)),
  };
}

export function buildDemoInstagram(input: ContentGenerationInput): InstagramDraft {
  const { video, transcript, target } = input;
  const sentences = splitSentences(transcript.text).filter((sentence) => sentence.length > 8);
  const isKorean = target.language === "ko";
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const points = pickEvenly(sentences, 7);

  const hook = isKorean
    ? clampText(`${video.title} — 3분이면 핵심만 남습니다`, 100)
    : clampText(`${video.title} — the only 3 minutes you need`, 100);

  const slideTitles = isKorean
    ? ["이 영상, 다 보고 나면 뭐가 남을까요?", "핵심 1", "핵심 2", "핵심 3", "적용 포인트", "저장해 두세요"]
    : ["What you keep after watching", "Point 1", "Point 2", "Point 3", "How to apply it", "Save this"];

  const slides = slideTitles.slice(0, 6).map((title, index) => ({
    index: index + 1,
    title,
    body: clampText(points[index] ?? points.at(-1) ?? video.title, 120),
    visualHint: isKorean ? "큰 제목 + 배경 단색" : "Large headline on a solid background",
  }));

  const cta = isKorean ? "저장하고 다음에 다시 보기 👉 팔로우도 환영해요" : "Save this post and follow for more →";

  const caption = isKorean
    ? [
        hook,
        "",
        ...points.slice(0, 4).map((point) => `• ${point}`),
        "",
        `영상 전체는 프로필 링크에서 확인하세요. ${video.channelTitle}`,
        "",
        cta,
      ].join("\n")
    : [hook, "", ...points.slice(0, 4).map((point) => `• ${point}`), "", "Full video in the link in bio.", "", cta].join("\n");

  return {
    format: "instagram",
    language: target.language,
    hook,
    caption: clampText(caption, 2000),
    slides,
    cta,
    hashtags: [
      "#" + keyword.replace(/\s+/g, ""),
      isKorean ? "#유튜브요약" : "#youtubesummary",
      isKorean ? "#콘텐츠마케팅" : "#contentmarketing",
      isKorean ? "#1인사업자" : "#solopreneur",
      isKorean ? "#생산성" : "#productivity",
      isKorean ? "#카드뉴스" : "#carousel",
      isKorean ? "#영상정리" : "#videoNotes",
      isKorean ? "#인스타그램마케팅" : "#instagramtips",
      isKorean ? "#브랜딩" : "#branding",
      isKorean ? "#자기계발" : "#selfdevelopment",
      isKorean ? "#업무자동화" : "#automation",
      isKorean ? "#리뷰" : "#review",
      isKorean ? "#정보공유" : "#learn",
      isKorean ? "#마케팅팁" : "#marketingtips",
      isKorean ? "#스타트업" : "#startup",
    ],
    keywords: [keyword],
  };
}

export function buildDemoFacebook(input: ContentGenerationInput): FacebookDraft {
  const { video, transcript, target } = input;
  const sentences = splitSentences(transcript.text).filter((sentence) => sentence.length > 8);
  const isKorean = target.language === "ko";
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const points = pickEvenly(sentences, 5);

  const body = isKorean
    ? [
        `"${video.title}" 영상을 보다가 문득 멈췄습니다.`,
        "",
        points[0] ?? "",
        "",
        (points[1] ?? "") + " " + (points[2] ?? ""),
        "",
        `영상 전체를 정리하면 ${keyword} 하나로 모입니다. 아래에 핵심만 남겨 두었습니다.`,
        "",
        "> 데모 모드 초안입니다. API 키를 설정하면 Claude가 이야기 흐름을 다듬습니다.",
      ].join("\n")
    : [
        `I paused halfway through "${video.title}" — and ended up rewatching it.`,
        "",
        points[0] ?? "",
        "",
        `${points[1] ?? ""} ${points[2] ?? ""}`.trim(),
        "",
        "Demo draft. Add ANTHROPIC_API_KEY to have Claude polish the narrative.",
      ].join("\n");

  return {
    format: "facebook",
    language: target.language,
    headline: clampText(video.title, 90),
    body: clampText(body, 2500),
    bullets: points.slice(0, 4),
    closingQuestion: isKorean
      ? `${keyword}, 여러분은 어떻게 적용하고 계신가요?`
      : `How are you applying ${keyword} in your own work?`,
    hashtags: isKorean ? ["#유튜브요약", "#콘텐츠마케팅", "#" + keyword.replace(/\s+/g, "")] : ["#youtubesummary", "#contentmarketing"],
    linkTitle: clampText(video.title, 90),
  };
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。？！]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = Math.floor(items.length / count);
  return Array.from({ length: count }, (_, index) => items[Math.min(index * step, items.length - 1)]).filter(
    (item): item is T => item !== undefined,
  );
}

function extractKeyword(title: string): string {
  const cleaned = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[|#]/g, " ");
  const words = cleaned.split(/\s+/).filter((word) => word.length >= 2);
  return words.slice(0, 3).join(" ") || "유튜브 콘텐츠";
}
