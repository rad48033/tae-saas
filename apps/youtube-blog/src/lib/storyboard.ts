import { createTextProviderFromEnv } from "@tae/ai";
import { generateStoryboard } from "@tae/video";
import type { SourceDocument } from "@tae/ai";
import type { AspectRatio, StoryboardResult } from "@tae/video";

/**
 * 앱에서 쓰는 스토리보드 생성기.
 * `AI_PROVIDER` → ANTHROPIC → OPENAI → GEMINI 키 순서로 실제 LLM을 쓰고,
 * 키가 하나도 없으면 @tae/video의 결정적 데모가 만듭니다.
 */
export async function createStoryboard(
  source: SourceDocument,
  aspectRatio: AspectRatio,
  language: "ko" | "en",
): Promise<StoryboardResult> {
  const provider = createTextProviderFromEnv(process.env) ?? undefined;

  return generateStoryboard(source, {
    aspectRatio,
    language,
    ...(provider ? { provider } : {}),
  });
}
