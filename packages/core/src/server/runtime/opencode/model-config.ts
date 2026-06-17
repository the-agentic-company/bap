import { parseModelReference } from "../../../lib/model-reference";

export type OpenCodeRuntimeModelConfig = {
  providerID: string;
  modelID: string;
};

export function buildOpenCodeRuntimeModelConfig(model: string): OpenCodeRuntimeModelConfig {
  const parsed = parseModelReference(model);
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
  };
}
