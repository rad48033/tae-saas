import { createAnthropicProvider, DEFAULT_MODEL } from "@tae/ai";
import { generateStoryboard } from "@tae/video";
import type { SourceDocument } from "@tae/ai";
import type { AspectRatio, StoryboardResult } from "@tae/video";

/**
 * 앱에서 쓰는 스토리보드 생성기.
 * ANTHROPIC_API_KEY가 있으면 Claude가 대본을, 없으면 @tae/video의 결정적 데모가 만듭니다.
 */
export async function createStoryboard(
  source: SourceDocument,
  aspectRatio: AspectRatio,
  language: "ko" | "en",
): Promise<StoryboardResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const provider = apiKey
    ? createAnthropicProvider({ apiKey, model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL })
    : undefined;

  return generateStoryboard(source, {
    aspectRatio,
    language,
    ...(provider ? { provider } : {}),
  });
}
