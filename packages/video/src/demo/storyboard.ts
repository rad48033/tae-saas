import { clampText, hasReadableContent, normalizeWhitespace, sanitizeHashtag, stripSocialNoise } from "@tae/ai";

import { aspectPreset } from "../aspect";
import { finalizeStoryboard } from "../storyboard";
import type { AspectPreset, Storyboard, StoryboardOptions, StoryboardScene, VideoLanguage } from "../types";
import type { SourceDocument } from "@tae/ai";

/**
 * API 키가 없을 때도 전체 파이프라인을 끝까지 돌리기 위한 결정적 스토리보드.
 *
 * 원문 문장을 장면 수만큼 나눠 배분하고, 장면마다 하나의 주제만 남깁니다.
 * 분량이 모자라면 사실을 더하지 않고 연결 문장만 덧붙입니다(데모임을 UI가 표시).
 */

const VISUAL_MOTIFS = [
  "a sunlit wooden desk with an open notebook, a pen and a cup of coffee",
  "hands sketching a simple diagram on paper with a pencil",
  "a laptop on a clean white desk beside a window with soft morning light",
  "a person walking through a bright modern office corridor, seen from behind",
  "a stack of books and a small plant on a shelf, shallow depth of field",
  "a city street at golden hour seen through a large window",
  "a whiteboard covered with abstract arrows, boxes and sticky notes",
  "an overhead shot of a phone, notebook and pen on a table",
  "a quiet cafe table with a laptop, headphones and a glass of water",
  "a minimal studio with warm lamps and a soft backdrop",
];

/**
 * 원문 주제에 맞는 장면 모티프.
 * 키 없이 이미지를 만들 때 "사무실 책상"만 나오면 원문과 따로 놀기 때문에,
 * 원문 단어를 보고 가족·식품, 뷰티, 여행, 개발 쪽 그림으로 갈라 줍니다.
 */
const THEMED_MOTIFS: { keywords: string[]; motifs: string[] }[] = [
  {
    keywords: ["유산균", "요구르트", "아기", "유아", "키즈", "우유", "분유", "영양", "건강", "식품", "간식", "비타민", "가족", "장 건강"],
    motifs: [
      "a bright family kitchen counter with yogurt cups, fresh milk and a small spoon",
      "a mother's hands handing a yogurt cup to a smiling toddler at a wooden table",
      "a close-up of a glass of milk with breakfast on a sunlit table",
      "a cozy living room where a family shares a healthy snack on a patterned rug",
      "an overhead flat lay of fresh dairy products, fruit and a linen cloth",
      "a child's lunchbox being packed on a clean kitchen island in morning light",
      "two parents smiling in a warm kitchen while preparing breakfast together",
      "a soft-focus shot of a refrigerator shelf with neatly stacked dairy cups",
      "a hand pouring a drink into a glass against a bright window",
      "a calm family breakfast scene, plates and glasses on a pale wooden table",
    ],
  },
  {
    keywords: ["화장품", "스킨", "크림", "뷰티", "향수", "세럼", "메이크업"],
    motifs: [
      "a minimal bathroom shelf with skincare bottles and soft morning light",
      "close-up of a hand applying cream in front of a mirror",
      "a marble counter with a towel, a bottle and a single green leaf",
      "softly lit bedroom vanity with a round mirror and warm tones",
      "an overhead flat lay of skincare products on linen",
    ],
  },
  {
    keywords: ["여행", "호텔", "숙소", "항공", "제주", "부산", "카페", "맛집"],
    motifs: [
      "a quiet seaside town at sunrise seen from a hillside path",
      "a hotel room window overlooking a city at dusk",
      "a cafe table by the window with coffee and a map",
      "a traveller's backpack and shoes beside a wooden door",
      "an aerial view of a coastal road with soft afternoon light",
    ],
  },
  {
    keywords: ["개발", "코드", "코딩", "앱", "서비스", "자동화", "데이터", "서버", "api"],
    motifs: [
      "a developer's desk with two monitors showing code and soft ambient light",
      "hands typing on a mechanical keyboard with a notebook nearby",
      "a whiteboard covered with arrows and product sketches",
      "a night city view through the window of a small home office",
      "a phone showing a simple app interface on a clean desk",
    ],
  },
  {
    keywords: ["운동", "헬스", "요가", "다이어트", "러닝"],
    motifs: [
      "a yoga mat by a large window in morning light",
      "running shoes on a park path at sunrise",
      "a water bottle and towel on a gym bench",
      "a person stretching in a bright empty studio",
    ],
  },
];

/** 원문 제목·본문에 어떤 주제어가 가장 많이 나오는지 보고 모티프 목록을 고릅니다. */
export function pickVisualMotifs(topicText: string): string[] {
  const haystack = topicText.toLowerCase();
  let best: { score: number; motifs: string[] } = { score: 0, motifs: VISUAL_MOTIFS };

  for (const themed of THEMED_MOTIFS) {
    const score = themed.keywords.reduce(
      (sum, keyword) => sum + (haystack.includes(keyword.toLowerCase()) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { score, motifs: themed.motifs };
  }

  return best.motifs;
}

const SHOT_TYPES = ["wide establishing shot", "close-up detail shot", "medium shot", "over-the-shoulder shot"];

const OPENERS_KO = [
  (title: string) => `오늘은 ${title} 이야기를 해보겠습니다.`,
  () => "먼저 왜 이 이야기가 지금 필요한지부터 보겠습니다.",
  () => "여기서부터가 실제로 써먹을 수 있는 부분입니다.",
  () => "말로만 들으면 추상적이니 순서대로 짚어 보겠습니다.",
  () => "중간에 한 번, 흔히 하는 착각을 짚고 넘어가겠습니다.",
  () => "이제 정리로 넘어가겠습니다.",
];

const FRAMES_KO = [
  "이 지점에서 한 번 짚고 넘어가겠습니다.",
  "여기서 잠깐, 왜 이게 중요한지 보겠습니다.",
  "이 부분은 실제로 해보면 바로 체감이 됩니다.",
  "다음 장면으로 넘어가겠습니다.",
  "조건이 다르면 결과도 달라진다는 점을 기억해 두세요.",
];

const CLOSING_KO = "오늘 이야기는 여기까지입니다. 다음 편에서 또 만나요.";

const OPENERS_EN = [
  (title: string) => `Today we're talking about ${title}.`,
  () => "Let's start with why this matters right now.",
  () => "This is the part you can actually use.",
  () => "It sounds abstract until you see the order, so let's go step by step.",
  () => "Halfway through, let's address the mistake most people make.",
  () => "Time to pull it together.",
];

const FRAMES_EN = [
  "Let's pause on this for a second.",
  "Here's why this matters.",
  "You feel this the moment you try it.",
  "Let's move to the next scene.",
  "Conditions change the result — keep that in mind.",
];

const CLOSING_EN = "That's it for today. See you in the next one.";

export function buildDemoStoryboard(source: SourceDocument, options: StoryboardOptions): Storyboard {
  const preset = aspectPreset(options.aspectRatio);
  const language: VideoLanguage = options.language ?? (source.language === "en" ? "en" : "ko");
  const opening =
    (language === "ko" ? OPENERS_KO[0]?.(source.title) : OPENERS_EN[0]?.(source.title)) ?? source.title;

  const titleKey = source.title.replace(/\s+/g, "").toLowerCase();
  const sentences = usableSentences(source.text).filter(
    (sentence) => sentence.replace(/\s+/g, "").toLowerCase() !== titleKey,
  );
  const motifs = pickVisualMotifs(`${source.title} ${source.text}`);
  const sceneCount = clampInt(
    options.maxScenes ?? chooseSceneCount(preset, sentences.join(" ").length),
    preset.scenes.min,
    preset.scenes.max,
  );

  const chunks = splitIntoScenes(sentences, sceneCount);
  const rate = preset.speechCharsPerSecond[language];
  const budgetChars = Math.round((preset.durationSeconds.target / sceneCount) * rate);
  const maxChars = Math.round(preset.maxSceneSeconds * rate);

  const scenes = chunks.map((chunk, index) => {
    const first = index === 0;
    const last = index === sceneCount - 1;
    const opener = first
      ? opening
      : last
        ? language === "ko"
          ? "정리하면 이렇습니다."
          : "Here's the summary."
        : "";

    const body = chunk.join(" ").trim();
    let narration = [opener, body].filter(Boolean).join(" ");

    // 분량이 부족하면 연결 문장으로 채웁니다. 사실은 더하지 않습니다.
    const frames = language === "ko" ? FRAMES_KO : FRAMES_EN;
    let frameIndex = 0;
    while (narration.length < Math.min(budgetChars * 0.72, maxChars * 0.8) && frameIndex < frames.length) {
      narration = `${narration} ${frames[frameIndex] ?? ""}`.trim();
      frameIndex += 1;
    }

    if (last) narration = `${narration} ${language === "ko" ? CLOSING_KO : CLOSING_EN}`;
    narration = clampText(narration, maxChars);

    return {
      title: sceneTitle(chunk[0] ?? source.title, index, language),
      narration,
      visualPrompt: buildVisualPrompt({
        motif: motifs[index % motifs.length] ?? motifs[0] ?? VISUAL_MOTIFS[0]!,
        shot: SHOT_TYPES[index % SHOT_TYPES.length] ?? SHOT_TYPES[0]!,
        topic: source.title,
        index,
      }),
      ...(index === 0 ? { onScreenText: clampText(source.title, 24) } : {}),
    };
  });

  const topicKeyword = keywordOf(source.title);
  const hashtags = (language === "ko"
    ? [topicKeyword, "유튜브쇼츠", "콘텐츠정리", "1분요약", "마케팅"]
    : [topicKeyword, "shorts", "contentstrategy", "summary"]
  )
    .map((tag) => sanitizeHashtag(tag))
    .filter((tag): tag is string => Boolean(tag))
    .slice(0, 8)
    .map((tag) => `#${tag}`);

  const draft = {
    title: clampText(source.title, 100),
    hook: scenes[0]?.narration ?? opening,
    description:
      language === "ko"
        ? `${source.author}의 원문 「${source.title}」을 ${options.aspectRatio === "9:16" ? "쇼츠" : "가로형 영상"} 대본으로 정리했습니다. 장면 ${scenes.length}개 · 약 ${Math.round(preset.durationSeconds.target)}초.`
        : `A ${scenes.length}-scene script built from "${source.title}" by ${source.author}.`,
    style: "cinematic editorial photography, warm natural light, shallow depth of field, muted colors, subtle film grain",
    scenes,
    hashtags,
  };

  return finalizeStoryboard(draft, {
    aspectRatio: options.aspectRatio,
    source,
    language,
    ...(options.voice ? { voice: options.voice } : {}),
    ...(options.targetDurationSeconds ? { targetDurationSeconds: options.targetDurationSeconds } : {}),
  });
}

function chooseSceneCount(preset: AspectPreset, textLength: number): number {
  const preferred = preset.scenes.preferred;
  if (textLength < 600) return Math.max(preset.scenes.min, preferred - 2);
  if (textLength < 1_400) return Math.max(preset.scenes.min, preferred - 1);
  return preferred;
}

function splitIntoScenes(sentences: string[], sceneCount: number): string[][] {
  if (sentences.length === 0) return Array.from({ length: sceneCount }, () => []);
  if (sentences.length <= sceneCount) {
    return Array.from({ length: sceneCount }, (_, index) => (sentences[index] ? [sentences[index]!] : []));
  }

  const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  const targetChars = totalChars / sceneCount;

  const buckets: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const sentence of sentences) {
    if (current.length > 0 && currentChars + sentence.length > targetChars * 1.15 && buckets.length < sceneCount - 1) {
      buckets.push(current);
      current = [sentence];
      currentChars = sentence.length;
      continue;
    }
    current.push(sentence);
    currentChars += sentence.length;
  }
  if (current.length > 0) buckets.push(current);

  // 장면 수를 정확히 맞춥니다(남는 장면은 마지막 버킷을 나눠 채움).
  while (buckets.length < sceneCount) {
    const last = buckets[buckets.length - 1];
    if (!last || last.length < 2) break;
    const half = Math.ceil(last.length / 2);
    buckets[buckets.length - 1] = last.slice(0, half);
    buckets.push(last.slice(half));
  }

  return buckets.slice(0, sceneCount);
}

function buildVisualPrompt(input: { motif: string; shot: string; topic: string; index: number }): string {
  const palette = ["warm amber", "cool blue", "soft sage", "muted terracotta", "neutral cream"][input.index % 5];
  return `${input.shot}: ${input.motif}, ${palette} palette, illustrating a video about ${input.topic}`;
}

function sceneTitle(text: string, index: number, language: VideoLanguage): string {
  const cleaned = text.replace(/^[\s"'“”‘’\-–—•]+/, "").replace(/[.!?。？！]$/, "").trim();
  if (!cleaned) return language === "ko" ? `장면 ${index + 1}` : `Scene ${index + 1}`;
  const words = cleaned.split(/\s+/).slice(0, language === "ko" ? 6 : 8).join(" ");
  return clampText(words, 40);
}

export function usableSentences(text: string): string[] {
  const withoutFrontmatter = text.replace(/^\s*---\s*\n[\s\S]*?\n---\s*\n/, "");
  const lines = withoutFrontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s*/, "").replace(/^\s*>\s?/, "").trim())
    .filter((line) => line.length > 0 && !/^[-*_]{3,}$/.test(line) && !/^\[[^\]]*\]\([^)]*\)$/.test(line))
    // "#협찬 #쁘띠앤서포터즈 |"처럼 태그만 있는 줄은 나레이션으로 쓰지 않습니다.
    .map((line) => stripSocialNoise(line))
    .filter((line) => line.length > 0 && hasReadableContent(line));

  const sentences = lines
    .flatMap((line) => line.split(/(?<=[.!?。？！]|다\.)\s+/))
    .map((sentence) => sentence.replace(/[*_`]/g, "").trim())
    .filter((sentence) => sentence.length > 12);

  return sentences.length > 0 ? sentences : [normalizeWhitespace(stripSocialNoise(text))].filter(Boolean);
}

function keywordOf(title: string): string {
  return (
    title
      .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
      .split(/[\s|#:：,·]+/)
      .filter((word) => word.length >= 2)
      .slice(0, 2)
      .join("") || "콘텐츠"
  );
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 데모 스토리보드의 장면을 UI에서 바로 보여줄 때 쓰는 요약 */
export function summarizeStoryboard(storyboard: Storyboard): string {
  const seconds = Math.round(storyboard.totalDurationMs / 1000);
  return `${storyboard.scenes.length}장면 · ${seconds}초 · ${storyboard.width}x${storyboard.height}`;
}

export type DemoScene = StoryboardScene;
