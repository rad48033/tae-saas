import { completeJson } from "../json";
import { buildPdfPrompt, type PdfStructureInput } from "../prompts/pdf";
import { pdfStructureSchemas, type PdfStructureData, type PdfStructureSchemaId } from "../schemas/pdf";
import type { AiProvider, TokenUsage } from "../types";

export interface PdfStructureResult<T extends PdfStructureSchemaId> {
  schema: T;
  data: PdfStructureData[T];
  provider: AiProvider["id"];
  model: string;
  usage: TokenUsage;
  repaired: boolean;
}

export async function structurePdfWithProvider<T extends PdfStructureSchemaId>(
  provider: AiProvider,
  input: PdfStructureInput & { schema: T },
): Promise<PdfStructureResult<T>> {
  const prompt = buildPdfPrompt(input);
  const schema = pdfStructureSchemas[input.schema];

  const { value, usage, model, provider: providerId, repaired } = await completeJson(
    provider,
    { system: prompt.system, prompt: prompt.prompt, maxTokens: prompt.maxTokens },
    schema,
  );

  return {
    schema: input.schema,
    data: value as PdfStructureData[T],
    provider: providerId,
    model,
    usage,
    repaired,
  };
}
