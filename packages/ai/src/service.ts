import { createAnthropicProvider, DEFAULT_MODEL } from "./anthropic-provider";
import { buildDemoContent } from "./demo/content";
import { buildDemoPdfStructure } from "./demo/pdf";
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

export interface AiServiceOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  /** 테스트/커스텀 구현 주입 */
  provider?: AiProvider;
}

export interface AiService {
  readonly mode: "anthropic" | "demo";
  readonly model: string;
  generateContent(input: ContentGenerationInput): Promise<ContentGenerationResult>;
  structurePdf<T extends PdfStructureSchemaId>(
    input: PdfStructureInput & { schema: T },
  ): Promise<PdfStructureResult<T>>;
}

export const DEMO_MODEL = "demo-heuristic";

/**
 * API 키가 있으면 Claude, 없으면 데모 생성기를 선택합니다.
 * 키가 있는데 호출이 실패하면 조용히 데모로 넘어가지 않고 오류를 그대로 던집니다.
 */
export function createAiService(options: AiServiceOptions = {}): AiService {
  const provider =
    options.provider ??
    (options.apiKey
      ? createAnthropicProvider({ apiKey: options.apiKey, model: options.model?.trim() || DEFAULT_MODEL })
      : null);

  if (!provider) return createDemoAiService();

  return {
    mode: provider.id === "demo" ? "demo" : "anthropic",
    model: provider.model,
    generateContent: (input) => generateContentWithProvider(provider, input),
    structurePdf: (input) => structurePdfWithProvider(provider, input),
  };
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
