import { createAnthropicProvider, DEFAULT_MODEL } from "./anthropic-provider";
import { buildDemoContent } from "./demo/content";
import { buildDemoPdfStructure } from "./demo/pdf";
import { createGeminiProvider } from "./gemini-provider";
import { createOpenAIProvider } from "./openai-provider";
import type { ContentGenerationInput } from "./prompts/content";
import type { PdfStructureInput } from "./prompts/pdf";
import {
  contentDraftSchema,
  type ContentDraft,
  type PdfStructureData,
  type PdfStructureSchemaId,
  pdfStructureSchemas,
} from "./schemas";
import { generateContentWithProvider, type ContentGenerationResult } from "./services/content";
import { structurePdfWithProvider, type PdfStructureResult } from "./services/pdf";
import type { AiProvider } from "./types";

/** 실제 텍스트 생성에 쓰는 제공자. 키가 없으면 demo. */
export type AiMode = "anthropic" | "openai" | "gemini" | "demo";

export type EnvLike = Record<string, string | undefined>;

export interface AiServiceOptions {
  /** Anthropic 키 (하위 호환: `apiKey`) */
  apiKey?: string | undefined;
  /** Anthropic 모델 (하위 호환: `model`) */
  model?: string | undefined;
  /** 테스트/커스텀 구현 주입 */
  provider?: AiProvider;
  /** 자동 순서를 무시하고 지정한 제공자를 씁니다. 키가 없으면 자동 순서로 돌아갑니다. */
  providerId?: AiMode;
  anthropic?: { apiKey?: string | undefined; model?: string | undefined };
  openai?: { apiKey?: string | undefined; model?: string | undefined; baseUrl?: string | undefined };
  gemini?: {
    apiKey?: string | undefined;
    model?: string | undefined;
    fallbackModels?: readonly string[] | undefined;
    baseUrl?: string | undefined;
  };
}

export interface AiService {
  readonly mode: AiMode;
  readonly model: string;
  generateContent(input: ContentGenerationInput): Promise<ContentGenerationResult>;
  structurePdf<T extends PdfStructureSchemaId>(
    input: PdfStructureInput & { schema: T },
  ): Promise<PdfStructureResult<T>>;
}

export const DEMO_MODEL = "demo-heuristic";

/** AI_PROVIDER로 강제 선택할 때 쓰는 값들 */
export const AI_MODES: readonly AiMode[] = ["anthropic", "openai", "gemini", "demo"] as const;

export function isAiMode(value: string | undefined): value is AiMode {
  return Boolean(value) && (AI_MODES as readonly string[]).includes(value as string);
}

/**
 * 환경변수에서 실제 텍스트 생성 제공자를 고릅니다.
 *
 *   AI_PROVIDER=anthropic|openai|gemini|demo   (지정하면 최우선, 키가 없으면 자동 순서)
 *   ANTHROPIC_API_KEY / ANTHROPIC_MODEL
 *   OPENAI_API_KEY    / OPENAI_TEXT_MODEL      (이미지·TTS 모델과 분리)
 *   GEMINI_API_KEY    / GEMINI_MODEL
 *
 * 자동 순서는 Claude → OpenAI → Gemini 입니다. 키가 하나도 없으면 null(데모)을 돌려줍니다.
 */
export function createTextProviderFromEnv(env: EnvLike = process.env): AiProvider | null {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const requested = env.AI_PROVIDER?.trim().toLowerCase();

  const build = (mode: AiMode): AiProvider | null => {
    if (mode === "anthropic") {
      return anthropicKey
        ? createAnthropicProvider({ apiKey: anthropicKey, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL })
        : null;
    }
    if (mode === "openai") {
      return openaiKey
        ? createOpenAIProvider({
            apiKey: openaiKey,
            ...(env.OPENAI_TEXT_MODEL?.trim() ? { model: env.OPENAI_TEXT_MODEL.trim() } : {}),
            ...(env.OPENAI_BASE_URL?.trim() ? { baseUrl: env.OPENAI_BASE_URL.trim() } : {}),
          })
        : null;
    }
    if (mode === "gemini") {
      return geminiKey
        ? createGeminiProvider({
            apiKey: geminiKey,
            ...(env.GEMINI_MODEL?.trim() ? { model: env.GEMINI_MODEL.trim() } : {}),
            ...(env.GEMINI_MODEL_FALLBACKS?.trim()
              ? { fallbackModels: env.GEMINI_MODEL_FALLBACKS.split(",").map((value) => value.trim()).filter(Boolean) }
              : {}),
            ...(env.GEMINI_BASE_URL?.trim() ? { baseUrl: env.GEMINI_BASE_URL.trim() } : {}),
          })
        : null;
    }
    return null;
  };

  if (isAiMode(requested)) {
    if (requested === "demo") return null;
    const provider = build(requested);
    if (provider) return provider;
  }

  for (const mode of ["anthropic", "openai", "gemini"] as const) {
    const provider = build(mode);
    if (provider) return provider;
  }

  return null;
}

/**
 * 제공자를 고르고 서비스로 감쌉니다.
 * 키가 있는데 호출이 실패하면 조용히 데모로 넘어가지 않고 오류를 그대로 던집니다.
 */
export function createAiService(options: AiServiceOptions = {}): AiService {
  const provider = options.provider ?? selectProvider(options);

  if (!provider) return createDemoAiService();

  return {
    mode: provider.id,
    model: provider.model,
    generateContent: (input) => generateContentWithProvider(provider, input),
    structurePdf: (input) => structurePdfWithProvider(provider, input),
  };
}

/** 환경변수만 보고 서비스를 만듭니다(앱 런타임용). */
export function createAiServiceFromEnv(env: EnvLike = process.env): AiService {
  const provider = createTextProviderFromEnv(env);
  return provider ? createAiService({ provider }) : createDemoAiService();
}

function selectProvider(options: AiServiceOptions): AiProvider | null {
  const anthropicKey = options.anthropic?.apiKey?.trim() || options.apiKey?.trim();
  const anthropicModel = options.anthropic?.model?.trim() || options.model?.trim();
  const openaiKey = options.openai?.apiKey?.trim();
  const geminiKey = options.gemini?.apiKey?.trim();

  const build = (mode: AiMode): AiProvider | null => {
    if (mode === "anthropic") {
      return anthropicKey
        ? createAnthropicProvider({ apiKey: anthropicKey, model: anthropicModel || DEFAULT_MODEL })
        : null;
    }
    if (mode === "openai") {
      return openaiKey
        ? createOpenAIProvider({
            apiKey: openaiKey,
            ...(options.openai?.model?.trim() ? { model: options.openai.model.trim() } : {}),
            ...(options.openai?.baseUrl?.trim() ? { baseUrl: options.openai.baseUrl.trim() } : {}),
          })
        : null;
    }
    if (mode === "gemini") {
      return geminiKey
        ? createGeminiProvider({
            apiKey: geminiKey,
            ...(options.gemini?.model?.trim() ? { model: options.gemini.model.trim() } : {}),
            ...(options.gemini?.fallbackModels?.length ? { fallbackModels: options.gemini.fallbackModels } : {}),
            ...(options.gemini?.baseUrl?.trim() ? { baseUrl: options.gemini.baseUrl.trim() } : {}),
          })
        : null;
    }
    return null;
  };

  if (options.providerId && options.providerId !== "demo") {
    const requested = build(options.providerId);
    if (requested) return requested;
  }
  if (options.providerId === "demo") return null;

  for (const mode of ["anthropic", "openai", "gemini"] as const) {
    const provider = build(mode);
    if (provider) return provider;
  }

  return null;
}

export function createDemoAiService(): AiService {
  return {
    mode: "demo",
    model: DEMO_MODEL,
    async generateContent(input: ContentGenerationInput): Promise<ContentGenerationResult> {
      const draft: ContentDraft = contentDraftSchema.parse(buildDemoContent(input));
      if (draft.format !== input.target.format) {
        throw new Error(`데모 생성기가 요청 형식(${input.target.format})과 다른 결과를 만들었습니다.`);
      }
      return {
        draft,
        provider: "demo",
        model: DEMO_MODEL,
        usage: { inputTokens: 0, outputTokens: 0 },
        repaired: false,
      };
    },
    async structurePdf<T extends PdfStructureSchemaId>(
      input: PdfStructureInput & { schema: T },
    ): Promise<PdfStructureResult<T>> {
      const schema = pdfStructureSchemas[input.schema];
      const data = schema.parse(buildDemoPdfStructure(input)) as PdfStructureData[T];
      return {
        schema: input.schema,
        data,
        provider: "demo",
        model: DEMO_MODEL,
        usage: { inputTokens: 0, outputTokens: 0 },
        repaired: false,
      };
    },
  };
}
