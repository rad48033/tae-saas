import type { ContentGenerationInput } from "../prompts/youtube";
import type {
  BlogDraft,
  ContentDraft,
  FacebookDraft,
  InstagramDraft,
  InstagramSlide,
} from "../schemas/content";
import { CONTENT_SPECS } from "../schemas/content";
import { clampText, countWords } from "../text";
import { normalizeSlug } from "../services/content";

/**
 * ANTHROPIC_API_KEY 없이 로컬에서 전체 흐름을 확인하기 위한 결정적 생성기.
 * 결과에는 항상 provider: "demo"가 붙고 UI에서 데모 모드로 표시됩니다.
 *
 * 데모 결과도 실제 상품과 같은 분량 스펙을 만족해야 UI/테스트가 의미를 갖습니다.
 *   blog      : 본문 2,000자 이상 · H2 5개 · FAQ 3개 이상 · 태그 8~10개
 *   instagram : 카드뉴스 10장 · 여러 문단 캡션 · 해시태그 15~20개
 *   facebook  : 불릿·질문까지 약 20줄
 *
 * 자막 문장은 "템플릿 문단을 대체"하지 않고 "인용으로 덧붙입니다". 그래야 자막이
 * 길든 짧든 결과가 같은 구조와 분량을 유지합니다.
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

// ── 블로그 ────────────────────────────────────────────────────────────────

export function buildDemoBlog(input: ContentGenerationInput): BlogDraft {
  const { video, transcript, target } = input;
  const sentences = usableSentences(transcript.text);
  const isKorean = target.language === "ko";
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const audience = target.audience?.trim();

  const buckets = splitIntoBuckets(sentences, 5);
  const why = buckets[0] ?? [];
  const principles = buckets[1] ?? [];
  const examples = buckets[2] ?? [];
  const caveats = buckets[3] ?? [];
  const actions = buckets[4] ?? [];

  const headings = isKorean
    ? [
        `왜 지금 ${keyword}인가`,
        "영상이 짚은 핵심 원리",
        "사례와 숫자로 확인하기",
        "장점과 한계: 통하는 조건",
        "정리: 오늘 바로 할 3단계",
      ]
    : [
        `Why ${keyword} matters now`,
        "The principles the video actually explains",
        "Checking it against real examples",
        "Where it works — and where it breaks",
        "Your next three steps",
      ];

  const summary = isKorean
    ? clampText(
        [
          `이 글은 ${video.channelTitle}의 "${video.title}" 자막을 근거로 ${keyword} 주제를 정리했습니다.`,
          "영상이 설명한 순서대로 원리, 사례, 한계를 짚고 마지막에 바로 실행할 3단계로 끝냅니다.",
          `${audience ?? "영상의 핵심을 빠르게 파악하려는 분"}이 5분 안에 판단할 수 있도록 썼습니다.`,
        ].join(" "),
        700,
      )
    : clampText(
        [
          `This post summarizes "${video.title}" by ${video.channelTitle}, using only what the transcript covers.`,
          "It follows the video's own order — principle, example, limits — and ends with three steps you can run today.",
          `It is written for ${audience ?? "readers who want the decision, not the recap"}.`,
        ].join(" "),
        700,
      );

  const body = isKorean
    ? blogBodyKo({ video, keyword, why, principles, examples, caveats, actions })
    : blogBodyEn({ video, keyword, why, principles, examples, caveats, actions });

  const faq = isKorean
    ? [
        {
          question: `${keyword} 주제는 어디서부터 시작하면 좋을까요?`,
          answer: clampText(
            `${examples[0] ?? principles[0] ?? "영상에서는 작은 단위부터 확인하라고 설명합니다."} 영상은 준비보다 첫 시도를 강조합니다. 가장 작은 단위로 한 번 해 보고, 결과를 기록한 뒤 범위를 넓히는 순서가 안전합니다.`,
            1100,
          ),
        },
        {
          question: "영상에서 말한 내용을 그대로 따라 해도 될까요?",
          answer: clampText(
            "영상은 특정 상황을 전제로 한 설명입니다. 업종, 팀 규모, 가진 자원이 다르면 같은 방법이 다른 결과를 냅니다. 본문의 '통하는 조건'을 먼저 확인하고, 내 상황에서 재현할 수 있는 부분만 가져오세요.",
            1100,
          ),
        },
        {
          question: "숫자나 지표는 어떻게 봐야 하나요?",
          answer: clampText(
            `${examples[1] ?? "영상은 수치를 목표가 아니라 판단 기준으로 쓰라고 말합니다."} 한 번의 결과보다 같은 조건에서 반복했을 때의 변화를 비교하는 편이 정확합니다.`,
            1100,
          ),
        },
        {
          question: "이 방법이 맞지 않는 경우는 언제인가요?",
          answer: clampText(
            `${caveats[0] ?? "영상에서도 예외를 인정합니다."} 시간이 촉박하거나 의사결정 권한이 없는 상황이라면, 먼저 이해관계자를 설득하는 단계가 필요합니다.`,
            1100,
          ),
        },
      ]
    : [
        {
          question: `Where should I start with ${keyword}?`,
          answer: clampText(
            `${examples[0] ?? "The video starts small on purpose."} Try the smallest possible version first, write down what happened, and only then expand the scope.`,
            1100,
          ),
        },
        {
          question: "Can I copy exactly what the video describes?",
          answer: clampText(
            "The video describes one situation. Team size, industry and available budget change the outcome, so check the 'where it works' section before copying anything.",
            1100,
          ),
        },
        {
          question: "How should I read the numbers?",
          answer: clampText(
            `${examples[1] ?? "Treat numbers as a decision rule, not a target."} Compare repeated runs under the same conditions rather than a single result.`,
            1100,
          ),
        },
      ];

  const tags = isKorean
    ? dedupeTags([
        keyword,
        `${keyword} 정리`,
        "유튜브 요약",
        "영상 요약",
        "콘텐츠 전략",
        video.channelTitle,
        "실행 체크리스트",
        "1인 사업",
        "생산성",
        "SEO",
      ])
    : dedupeTags([
        keyword,
        `${keyword} summary`,
        "youtube summary",
        "video notes",
        "content strategy",
        video.channelTitle,
        "checklist",
        "solopreneur",
        "productivity",
        "SEO",
      ]);

  const title = isKorean
    ? clampText(`${video.title} 핵심 정리: ${keyword}편`, 70)
    : clampText(`${video.title} — key takeaways on ${keyword}`, 80);

  return {
    format: "blog",
    language: target.language,
    title,
    slug: normalizeSlug(undefined, `${keyword} ${video.id}`),
    metaDescription: isKorean
      ? clampText(
          `${keyword} 주제를 "${video.title}" 자막 근거로 정리했습니다. 핵심 원리, 사례, 통하는 조건과 오늘 바로 할 3단계까지 ${CONTENT_SPECS.blog.bodyChars.min.toLocaleString()}자 분량으로 담았습니다.`.trim(),
          150,
        )
      : clampText(
          `A transcript-based breakdown of ${keyword} from "${video.title}": the principle, the examples, the limits, and three steps to run today.`,
          150,
        ),
    primaryKeyword: keyword,
    secondaryKeywords: isKorean
      ? [keyword, "영상 요약", "콘텐츠 전략"]
      : [keyword, "video summary", "content strategy"],
    executiveSummary: summary,
    outline: headings.map((heading, index) => {
      const point = [why, principles, examples, caveats, actions][index]?.[0];
      return { heading, points: point ? [point] : [] };
    }),
    body,
    keyTakeaways: [
      principles[0] ?? (isKorean ? "영상의 결론은 준비보다 첫 시도입니다." : "Start before you feel ready."),
      examples[0] ?? (isKorean ? "사례는 한 번의 결과가 아니라 반복 비교로 봅니다." : "Judge results across repeated runs."),
      caveats[0] ?? (isKorean ? "조건이 다르면 같은 방법도 다른 결과를 냅니다." : "The same method fails under different conditions."),
      isKorean ? "오늘 할 일은 3단계로 좁혀서 시작합니다." : "Narrow today's action to three steps.",
    ],
    faq,
    tags,
    readingTimeMinutes: Math.max(1, Math.ceil(countWords(body) / 500)),
  };
}

function blogBodyKo(input: {
  video: { title: string; channelTitle: string };
  keyword: string;
  why: string[];
  principles: string[];
  examples: string[];
  caveats: string[];
  actions: string[];
}): string {
  const { video, keyword, why, principles, examples, caveats, actions } = input;

  const quotes = (list: string[], count = 2) =>
    list
      .slice(0, count)
      .map((sentence) => `> ${sentence}`)
      .join("\n>\n");

  const intro = [
    `"${video.title}" 영상을 처음 켰을 때는 흔한 요약 영상이겠거니 했습니다. 그런데 자막을 따라가다 보면 이야기의 중심이 계속 ${keyword} 쪽으로 돌아옵니다.`,
    why[0] ? `영상은 이렇게 시작합니다.\n\n${quotes([why[0]], 1)}` : "",
    `그래서 이 글은 결론부터 말하고, 근거와 적용 순서를 뒤에 붙였습니다. 읽고 나면 무엇을 먼저 바꿔야 하는지 한 가지는 정해질 겁니다.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section1 = [
    `영상이 이 주제를 꺼내는 방식은 단순한 정의에서 시작하지 않습니다. 실제로 겪는 문제를 먼저 보여 주고, 그다음에 원인을 설명합니다.`,
    why.length > 1 ? `영상의 문제 제기는 이렇게 이어집니다.\n\n${quotes(why.slice(1), 2)}` : "",
    `이 순서가 중요한 이유는 독자가 자기 상황을 먼저 떠올리게 만들기 때문입니다. 정의부터 시작하는 글은 읽고 나서도 어디에 적용할지 남지 않습니다.`,
    `${keyword} 주제는 특별한 기술이라기보다 판단의 순서에 가깝다고 영상은 말합니다. 무엇을 먼저 보고, 무엇을 나중에 결정하는지가 결과를 가른다는 설명입니다.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section2 = [
    `첫 번째 원리는 현재 상태를 정확히 보는 것입니다. 여기서 말하는 '정확히'는 감이 아니라 기록을 뜻합니다. 기억은 좋은 쪽으로 기울기 때문에, 적어 두지 않으면 비교할 기준이 사라집니다.`,
    principles.length > 0 ? `영상이 짚은 원리는 이렇습니다.\n\n${quotes(principles, 3)}` : "",
    `두 번째 원리는 범위를 좁히는 것입니다. 한 번에 전체를 바꾸려 하면 무엇이 효과가 있었는지 알 수 없고, 결과가 나빠졌을 때 원인도 찾을 수 없습니다.`,
    `세 번째 원리는 결과를 비교 가능한 형태로 남기는 것입니다. 같은 조건에서 두 번 반복한 결과만이 다음 결정의 근거가 됩니다.`,
    `정리하면 이렇습니다.\n\n- 먼저 현재 상태를 기록합니다.\n- 한 번에 하나만 바꿉니다.\n- 같은 조건에서 반복해 비교합니다.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const numbers = examples.filter((sentence) => /\d/.test(sentence));
  const section3 = [
    `영상은 추상적인 조언 대신 구체적인 장면을 듭니다. 어떤 상황에서 무엇이 달라졌는지를 보여 주고, 시청자가 자기 경험과 겹쳐 보게 만듭니다.`,
    examples.length > 0 ? `영상에서 든 사례는 이렇습니다.\n\n${quotes(examples, 3)}` : "",
    numbers.length > 0
      ? `영상이 직접 언급한 숫자도 있습니다. ${numbers.slice(0, 2).join(" ")} 숫자를 목표로 삼기보다 판단 기준으로 쓰라는 것이 영상의 태도입니다.`
      : `영상은 구체적인 수치를 제시하기보다 상황을 설명하는 쪽을 택합니다. 숫자가 없어도 판단은 가능하다는 뜻이고, 대신 비교 대상과 조건을 분명히 하라고 말합니다.`,
    `사례를 볼 때는 결과보다 조건을 먼저 봐야 합니다. 같은 방법이라도 팀 규모와 의사결정 속도가 다르면 결과가 달라집니다.`,
    `비교표로 정리하면 이렇게 됩니다.\n\n| 구분 | 영상이 든 경우 | 내 상황에 옮길 때 |\n| --- | --- | --- |\n| 조건 | 영상이 전제한 환경 | 내 자원과 권한 |\n| 측정 | 반복 비교 | 같은 기간의 변화 |\n| 판단 | 조건이 맞을 때만 적용 | 맞지 않으면 축소 적용 |`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section4 = [
    `이 방법이 통하는 조건은 분명합니다. 결과를 확인할 수 있고, 한 번에 하나씩 바꿀 여유가 있으며, 기록을 남길 사람이 있을 때입니다.`,
    caveats.length > 0 ? `영상이 인정한 예외도 있습니다.\n\n${quotes(caveats, 2)}` : "",
    `반대로 시간이 촉박하거나 의사결정 권한이 없는 상황에서는 같은 방법이 답답하게 느껴질 수 있습니다.`,
    `흔한 실수는 결과가 좋지 않을 때 방법 전체를 바꾸는 것입니다. 영상은 원인이 아니라 조건을 먼저 확인하라고 말합니다.`,
    `영상에서도 모든 상황에 통하는 정답은 없다고 인정합니다. 조건이 다르면 적용 범위를 줄이는 편이 낫다는 설명입니다.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section5 = [
    `여기까지 읽었다면 오늘 할 일은 세 가지로 충분합니다.`,
    `1. 지금 상태를 한 장으로 적습니다. 지표든 메모든, 비교할 수 있는 형태면 됩니다.\n2. 바꿀 것 하나를 정합니다. 두 개를 동시에 바꾸면 원인을 알 수 없습니다.\n3. 일주일 뒤 같은 방식으로 다시 적습니다. 그 차이가 다음 결정의 근거가 됩니다.`,
    actions.length > 0 ? `영상이 마지막에 강조한 부분도 같은 맥락입니다.\n\n${quotes(actions, 1)}` : "",
    `영상 전체를 다시 볼 시간이 없다면, 위 세 단계만 실행해도 방향은 잡힙니다. 자세한 맥락은 영상 원본에서 확인하세요.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    intro,
    `## 왜 지금 ${keyword}인가\n\n${section1}`,
    `## 영상이 짚은 핵심 원리\n\n${section2}`,
    `## 사례와 숫자로 확인하기\n\n${section3}`,
    `## 장점과 한계: 통하는 조건\n\n${section4}`,
    `## 정리: 오늘 바로 할 3단계\n\n${section5}`,
    "> 데모 모드에서 생성된 초안입니다. ANTHROPIC_API_KEY를 설정하면 Claude가 문장과 구조를 다듬은 결과를 받습니다.",
  ].join("\n\n");
}

function blogBodyEn(input: {
  video: { title: string; channelTitle: string };
  keyword: string;
  why: string[];
  principles: string[];
  examples: string[];
  caveats: string[];
  actions: string[];
}): string {
  const { video, keyword, why, principles, examples, caveats, actions } = input;

  const quotes = (list: string[], count = 2) =>
    list
      .slice(0, count)
      .map((sentence) => `> ${sentence}`)
      .join("\n>\n");

  const intro = [
    `I put "${video.title}" on expecting another summary video. Halfway through, it was clear the whole thing keeps circling back to one idea: ${keyword}.`,
    why[0] ? `This is how the video opens:\n\n${quotes([why[0]], 1)}` : "",
    `So this post gives you the conclusion first and the reasoning after. By the end you should know the one thing to change this week.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section1 = [
    "The video never opens with a definition. It shows the problem first and explains the cause afterwards.",
    why.length > 1 ? `Here is how the problem is framed:\n\n${quotes(why.slice(1), 2)}` : "",
    "That order matters. A definition-first explainer leaves you with nothing to apply; a problem-first one gives you a place to start.",
    `The video treats ${keyword} as a sequence of judgments rather than a technique — what you look at first decides what you decide later.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const section2 = [
    "The first principle is recording the current state accurately. Accurate here means written down, not remembered — memory drifts toward whatever story you prefer.",
    principles.length > 0 ? `The principles the video names:\n\n${quotes(principles, 3)}` : "",
    "The second is narrowing the scope. Change everything at once and you cannot tell what worked, or why a result got worse.",
    "The third is keeping results in a comparable form. Only two runs under the same conditions give you a basis for the next decision.",
    "In short:\n\n- Record the current state.\n- Change one thing at a time.\n- Repeat under the same conditions and compare.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const numbers = examples.filter((sentence) => /\d/.test(sentence));
  const section3 = [
    "Instead of abstractions, the video walks through a concrete situation and lets you map it onto your own experience.",
    examples.length > 0 ? `The examples it uses:\n\n${quotes(examples, 3)}` : "",
    numbers.length > 0
      ? `There are numbers too: ${numbers.slice(0, 2).join(" ")} The video treats them as a decision rule, not a target.`
      : "The video avoids hard numbers and describes situations instead, which is a signal to compare conditions rather than chase a benchmark.",
    "When you read a case, look at the conditions before the result. Team size and decision speed change the outcome.",
    "| Dimension | In the video | In your context |\n| --- | --- | --- |\n| Conditions | The environment it assumes | Your resources and authority |\n| Measurement | Repeated runs | Change over the same period |\n| Decision | Apply when conditions match | Shrink the scope if they do not |",
  ]
    .filter(Boolean)
    .join("\n\n");

  const section4 = [
    "This works when you can see the result, when you can change one thing at a time, and when someone writes it down.",
    caveats.length > 0 ? `The exceptions it admits:\n\n${quotes(caveats, 2)}` : "",
    "It feels slow when deadlines are tight or when you have no authority over the decision.",
    "The common mistake is replacing the whole method when results disappoint, instead of checking the conditions.",
    "The video admits the exception too: there is no universal answer, and shrinking the scope beats forcing a fit.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const section5 = [
    "Three steps are enough for today.",
    "1. Write the current state on one page — a metric, a note, anything comparable.\n2. Pick one thing to change. Two changes hide the cause.\n3. Write the same page again in a week. That difference is your next decision.",
    actions.length > 0 ? `The closing point of the video fits here:\n\n${quotes(actions, 1)}` : "",
    "If you never rewatch the video, these three steps still point you in the right direction. The full context is in the original.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    intro,
    `## Why ${keyword} matters now\n\n${section1}`,
    `## The principles the video actually explains\n\n${section2}`,
    `## Checking it against real examples\n\n${section3}`,
    `## Where it works — and where it breaks\n\n${section4}`,
    `## Your next three steps\n\n${section5}`,
    "> Draft generated in demo mode. Set ANTHROPIC_API_KEY to have Claude rewrite and structure the post.",
  ].join("\n\n");
}

// ── 인스타그램 ────────────────────────────────────────────────────────────

export function buildDemoInstagram(input: ContentGenerationInput): InstagramDraft {
  const { video, transcript, target } = input;
  const sentences = usableSentences(transcript.text);
  const isKorean = target.language === "ko";
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const points = pickEvenly(sentences, 7);

  const hook = isKorean
    ? clampText(`${video.title} — 3분이면 ${keyword} 핵심만 남습니다`, 100)
    : clampText(`${video.title} — the only 3 minutes you need on ${keyword}`, 100);

  const slides: InstagramSlide[] = [];

  slides.push({
    index: 1,
    role: "cover",
    title: clampText(isKorean ? `${keyword}, 이렇게 정리됩니다` : `${keyword}, summarized`, 60),
    body: clampText(
      isKorean
        ? `${video.channelTitle} 영상에서 실제로 말한 것만 골랐습니다. 저장해 두고 하나씩 적용해 보세요.`
        : `Only what ${video.channelTitle} actually said. Save it and apply one point at a time.`,
      120,
    ),
    visualHint: isKorean ? "큰 제목 + 단색 배경, 하단에 채널명" : "Large headline on a solid background, channel name at the bottom",
  });

  for (let index = 0; index < 7; index += 1) {
    const sentence = points[index] ?? points.at(-1) ?? video.title;
    const others = points.filter((point) => point !== sentence);
    const next = points[index + 1];
    // 자막이 짧아 포인트가 모자랄 때는 제목과 본문이 같은 문장이 되지 않도록 다른 문장을 씁니다.
    const bodySource = next && next !== sentence ? next : (others[index % Math.max(others.length, 1)] ?? sentence);
    slides.push({
      index: index + 2,
      role: "point",
      title: clampText(stripTrailingPunctuation(sentence), 30),
      body: clampText(bodySource, 120),
      visualHint: isKorean ? "번호 + 짧은 문장, 여백 넉넉히" : "Numbered point with generous white space",
    });
  }

  slides.push({
    index: 9,
    role: "caveat",
    title: clampText(isKorean ? "적용 전에 확인할 것" : "Before you apply it", 60),
    body: clampText(
      isKorean
        ? "영상은 특정 조건을 전제로 합니다. 팀 규모와 권한이 다르면 범위를 줄여서 시도하세요. 한 번에 두 가지를 바꾸면 원인을 알 수 없습니다."
        : "The video assumes a specific setup. Different team size or authority means a smaller scope. Change one thing at a time.",
      200,
    ),
    visualHint: isKorean ? "주의 아이콘 + 톤 다운된 배경" : "Warning icon on a muted background",
  });

  slides.push({
    index: 10,
    role: "summary",
    title: clampText(isKorean ? "요약 · 저장하고 팔로우" : "Summary · save & follow", 60),
    body: clampText(
      isKorean ? "오늘 할 일은 하나만 정하는 것. 저장해 두고 주말에 다시 보세요." : "Decide one thing today. Save this and come back at the weekend.",
      120,
    ),
    visualHint: isKorean ? "체크리스트 3줄 + 저장 버튼 모양" : "Three-line checklist with a save icon",
  });

  const cta = isKorean ? "저장하고 다음에 다시 보기 👉 팔로우도 환영해요" : "Save this post and follow for more →";

  const caption = isKorean
    ? [
        hook,
        "",
        `${video.channelTitle}의 "${video.title}"를 두 번 봤습니다. 처음엔 흐름을, 두 번째엔 자막을 따라가면서요. 남은 건 결국 ${keyword} 하나였습니다.`,
        "",
        "영상이 말한 핵심은 이렇습니다.",
        ...points.slice(0, 4).map((point) => `• ${point}`),
        "",
        `여기서 끝내면 또 잊어버립니다. 그래서 오늘 할 일을 하나로 줄였습니다. 지금 상태를 한 줄로 적고, 바꿀 것 하나만 정하는 것. 그게 ${keyword}의 시작입니다.`,
        "",
        "영상은 준비보다 첫 시도를 강조합니다. 완벽한 계획을 세우는 동안 비교할 기준이 없으면, 다음 결정도 다시 감으로 돌아갑니다. 카드뉴스 2~8장이 그 순서를 담고 있습니다.",
        "",
        "카드뉴스를 정리하면서 제일 많이 지운 말은 '언제부터 시작할까'였습니다. 답은 늘 지금이었고, 대신 무엇을 먼저 기록할지가 관건이었습니다. 그래서 1장은 약속, 10장은 오늘 할 일 하나로 끝냅니다.",
        "",
        "한 가지 주의할 점. 영상은 특정 조건을 전제로 합니다. 팀 규모나 의사결정 권한이 다르면 같은 방법이 다른 결과를 냅니다. 그래서 9번 장에 체크리스트를 넣었습니다. 저장해 두고 적용 전에 한 번만 확인해 보세요.",
        "",
        "영상 전체는 프로필 링크에서 확인하세요.",
        "",
        cta,
      ].join("\n")
    : [
        hook,
        "",
        `I watched "${video.title}" by ${video.channelTitle} twice — once for the flow, once for the transcript. What stayed was ${keyword}.`,
        "",
        "What the video actually says:",
        ...points.slice(0, 4).map((point) => `• ${point}`),
        "",
        "Knowing it is not the hard part. Doing it is. So I cut today's action to one line: write down where you are, then pick one thing to change.",
        "",
        "The video pushes for an early attempt over a perfect plan. Without a baseline, every later decision slides back to guesswork. Slides 2 to 8 walk through that order.",
        "",
        "One caveat: the video assumes a specific setup. Different team size or authority changes the result, which is why slide 9 is a checklist.",
        "",
        "Full video in the link in bio.",
        "",
        cta,
      ].join("\n");

  return {
    format: "instagram",
    language: target.language,
    hook,
    caption: clampText(ensureCaptionLength(caption, target.language), 2200),
    slides,
    cta,
    hashtags: buildHashtags(keyword, video.channelTitle, isKorean),
    keywords: [keyword],
  };
}

function ensureCaptionLength(caption: string, language: "ko" | "en"): string {
  const min = CONTENT_SPECS.instagram.captionChars.min;
  if (caption.length >= min) return caption;

  // 자막이 짧아 포인트가 적을 때도 최소 분량을 지킵니다.
  // 사실을 더하지 않고, 카드뉴스를 쓰는 방법만 덧붙입니다.
  const filler =
    language === "ko"
      ? "이 카드뉴스는 한 번에 다 적용하려고 만든 게 아닙니다. 오늘은 1장과 10장만 보고, 내 상황에서 바꿀 수 있는 한 가지를 메모해 두세요. 나머지 장은 그 다음 주에 하나씩 꺼내 보면 됩니다. 저장해 두면 다시 찾기 쉽습니다."
      : "This carousel is not meant to be applied all at once. Today, read slide 1 and slide 10 only, and note the one thing you can change in your own situation. Come back to the rest one slide at a time next week — that is why saving it helps. ";

  return `${caption}\n\n${filler}`;
}

function buildHashtags(keyword: string, channelTitle: string, isKorean: boolean): string[] {
  const base = isKorean
    ? [
        keyword.replace(/\s+/g, ""),
        `${keyword.replace(/\s+/g, "")}정리`,
        "유튜브요약",
        "영상요약",
        "카드뉴스",
        "콘텐츠마케팅",
        "콘텐츠전략",
        "1인사업자",
        "생산성",
        "업무자동화",
        "자기계발",
        "정보공유",
        "마케팅팁",
        "브랜딩",
        "스타트업",
        "인스타그램마케팅",
        channelTitle.replace(/\s+/g, ""),
        "학습기록",
      ]
    : [
        keyword.replace(/\s+/g, ""),
        `${keyword.replace(/\s+/g, "")}tips`,
        "youtubesummary",
        "videonotes",
        "carousel",
        "contentmarketing",
        "contentstrategy",
        "solopreneur",
        "productivity",
        "automation",
        "selfdevelopment",
        "learn",
        "marketingtips",
        "branding",
        "startup",
        "instagramtips",
        channelTitle.replace(/\s+/g, ""),
        "buildinpublic",
      ];

  // 15~20개 유지: 중복을 제거하고 상한까지만 남깁니다.
  return dedupeTags(base)
    .slice(0, CONTENT_SPECS.instagram.hashtags.max)
    .map((tag) => `#${tag}`);
}

// ── 페이스북 ──────────────────────────────────────────────────────────────

export function buildDemoFacebook(input: ContentGenerationInput): FacebookDraft {
  const { video, transcript, target } = input;
  const sentences = usableSentences(transcript.text);
  const isKorean = target.language === "ko";
  const keyword = target.focusKeyword?.trim() || extractKeyword(video.title);
  const points = pickEvenly(sentences, 5);

  // 스토리 13줄 + 불릿 5개 + 질문 1줄 + 헤드라인 1줄 ≈ 20줄
  const storyLines = isKorean
    ? [
        `"${video.title}" 영상을 보다가 중간에 멈췄습니다.`,
        points[0] ?? "처음엔 흔한 조언이라고 생각했습니다.",
        points[1] ?? "그런데 자막을 다시 따라가 보니 이야기가 한 곳으로 모입니다.",
        `처음엔 별거 아니라고 생각했습니다. 그런데 두 번째로 보니 ${keyword} 이야기가 계속 나옵니다.`,
        points[2] ?? "말은 쉬운데 실제로 해 둔 사람은 적더군요.",
        "여기서 제가 놓쳤던 게 있었습니다. 영상은 결과보다 조건을 먼저 보라고 하더군요.",
        points[3] ?? "조건이 다르면 같은 방법도 결과가 달라진다는 이야기입니다.",
        "그래서 어제 한 가지만 바꿔 봤습니다. 바꾼 건 하나인데, 비교할 기준이 없으니 확신은 아직 없습니다.",
        points[4] ?? "이번 주에는 기준부터 적어 두려고 합니다.",
        "영상을 정리하면 이렇게 남습니다.",
        "완벽하게 준비하고 시작하는 것보다, 작게 한 번 해 보고 기록하는 쪽이 빨랐습니다.",
        "다만 이 방법도 시간이 촉박하면 답답합니다. 그럴 땐 범위를 줄이는 게 낫습니다.",
        isKorean ? "> 데모 모드 초안입니다. API 키를 설정하면 Claude가 이야기 흐름을 다듬습니다." : "",
      ]
    : [
        `I paused halfway through "${video.title}".`,
        points[0] ?? "At first it sounded like generic advice.",
        points[1] ?? "Second pass through the transcript, everything pointed one way.",
        "First watch, it felt obvious. Second watch, the same theme kept coming back.",
        points[2] ?? "Easy to say. Few people actually do it.",
        "What I had missed: the video looks at conditions before results.",
        points[3] ?? "Same method, different conditions, different outcome.",
        "So I changed exactly one thing yesterday. One change, no baseline — so I am not confident yet.",
        points[4] ?? "This week I am writing the baseline down first.",
        "What stays with me:",
        "A small attempt with notes beat a perfect plan I never started.",
        "It does stall when deadlines are tight, though. Shrinking the scope works better then.",
        "> Demo draft. Add ANTHROPIC_API_KEY to have Claude polish the narrative.",
      ];

  const body = storyLines
    .filter((line) => line.trim().length > 0)
    .flatMap((line, index) => (index === 0 ? [line] : ["", line]))
    .join("\n");

  return {
    format: "facebook",
    language: target.language,
    headline: clampText(isKorean ? `${video.title} — 보고 나서 바꾼 한 가지` : `${video.title} — the one thing I changed`, 90),
    body: clampText(body, 5500),
    bullets: isKorean
      ? [
          `핵심은 ${keyword} 하나로 모입니다.`,
          "결과보다 조건을 먼저 봅니다.",
          "한 번에 하나만 바꿉니다.",
          "같은 조건에서 반복해 비교합니다.",
          "기록이 없으면 다음 결정도 없습니다.",
        ]
      : [
          `It comes down to ${keyword}.`,
          "Look at conditions before results.",
          "Change one thing at a time.",
          "Compare repeated runs, not single ones.",
          "No notes, no next decision.",
        ],
    closingQuestion: isKorean
      ? `${keyword} 주제를 여러분은 어떻게 적용하고 계신가요?`
      : `How are you applying ${keyword} in your own work?`,
    hashtags: isKorean
      ? dedupeTags(["유튜브요약", "콘텐츠마케팅", keyword.replace(/\s+/g, "")])
          .slice(0, 3)
          .map((tag) => `#${tag}`)
      : dedupeTags(["youtubesummary", "contentmarketing"])
          .slice(0, 3)
          .map((tag) => `#${tag}`),
    linkTitle: clampText(video.title, 90),
  };
}

// ── 공통 유틸 ─────────────────────────────────────────────────────────────

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。？！]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function usableSentences(text: string): string[] {
  const sentences = splitSentences(text).filter((sentence) => sentence.length > 8);
  return sentences.length > 0 ? sentences : [text.trim()].filter(Boolean);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?。？！,，]+$/u, "").trim();
}

function splitIntoBuckets<T>(items: T[], count: number): T[][] {
  if (items.length === 0) return Array.from({ length: count }, () => []);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * items.length) / count);
    const end = Math.floor(((index + 1) * items.length) / count);
    return items.slice(start, end);
  });
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length === 0) return [];
  if (items.length <= count) return items;
  const step = Math.floor(items.length / count);
  return Array.from({ length: count }, (_, index) => items[Math.min(index * step, items.length - 1)]).filter(
    (item): item is T => item !== undefined,
  );
}

function dedupeTags(values: string[]): string[] {
  const cleaned = values.map((value) => value.replace(/^#+/, "").trim()).filter((value) => value.length > 0);
  return Array.from(new Set(cleaned));
}

function extractKeyword(title: string): string {
  const cleaned = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[|#]/g, " ");
  const words = cleaned.split(/\s+/).filter((word) => word.length >= 2);
  return words.slice(0, 3).join(" ") || "유튜브 콘텐츠";
}
