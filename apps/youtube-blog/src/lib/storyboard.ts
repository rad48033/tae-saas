import { createTextProviderFromEnv } from "@tae/ai";
import { generateStoryboard } from "@tae/video";
import type { SourceDocument } from "@tae/ai";
import type { AspectRatio, ReferenceImage, StoryboardResult } from "@tae/video";

export interface StoryboardReferenceInput {
  /** 실제 제품·공간 사진 주소 */
  url: string;
  label?: string;
  role?: "product" | "scene" | "style";
}

/**
 * 앱에서 쓰는 스토리보드 생성기.
 * `AI_PROVIDER` → ANTHROPIC → OPENAI → GEMINI 키 순서로 실제 LLM을 쓰고,
 * 키가 하나도 없으면 @tae/video의 결정적 데모가 만듭니다.
 *
 * `referenceImages`를 넘기면 대본이 제품 외관을 상상하지 않고 그 사진을 가리키며,
 * 스토리보드에 사진 주소가 기록되어 렌더 단계가 같은 사진을 참조 이미지로 씁니다.
 */
export async function createStoryboard(
  source: SourceDocument,
  aspectRatio: AspectRatio,
  language: "ko" | "en",
  referenceImages: StoryboardReferenceInput[] = [],
): Promise<StoryboardResult> {
  const provider = createTextProviderFromEnv(process.env) ?? undefined;
  const references: ReferenceImage[] = referenceImages
    .map((reference, index) => ({
      url: reference.url,
      label: reference.label?.trim() || `제품 사진 ${index + 1}`,
      role: reference.role ?? ("product" as const),
    }))
    .slice(0, 6);

  return generateStoryboard(source, {
    aspectRatio,
    language,
    ...(provider ? { provider } : {}),
    ...(references.length > 0 ? { referenceImages: references } : {}),
  });
}
