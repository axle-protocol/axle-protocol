import {
  CostData,
  MODEL_PRICING,
  ModelPricing,
  LAMPORTS_PER_SOL,
  SOL_PRICE_USD,
} from "./types.js";

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try prefix match (e.g., "gpt-4-turbo-2024-01-25" -> "gpt-4-turbo")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) {
      return pricing;
    }
  }

  // Default pricing (conservative estimate)
  console.warn(`Unknown model pricing for ${model}, using default`);
  return { input: 0.01, output: 0.03 };
}

/**
 * Calculate cost from token usage
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): CostData {
  const pricing = getModelPricing(model);

  // Calculate USD cost
  const inputUsd = (inputTokens / 1000) * pricing.input;
  const outputUsd = (outputTokens / 1000) * pricing.output;
  const totalUsd = inputUsd + outputUsd;

  // Convert to lamports (smallest SOL unit)
  // 1 SOL = 1,000,000,000 lamports
  const totalLamports = Math.ceil(
    (totalUsd / SOL_PRICE_USD) * LAMPORTS_PER_SOL
  );

  return {
    input_usd: Number(inputUsd.toFixed(8)),
    output_usd: Number(outputUsd.toFixed(8)),
    total_usd: Number(totalUsd.toFixed(8)),
    total_lamports: totalLamports,
  };
}

/**
 * Validate that reported usage matches provider response
 */
export function validateProviderUsage(
  reportedInput: number,
  reportedOutput: number,
  providerInput: number,
  providerOutput: number,
  tolerance: number = 0.05 // 5% tolerance for edge cases
): boolean {
  const inputDiff = Math.abs(reportedInput - providerInput) / providerInput;
  const outputDiff = Math.abs(reportedOutput - providerOutput) / providerOutput;

  return inputDiff <= tolerance && outputDiff <= tolerance;
}

/**
 * Format cost for display
 */
export function formatCost(cost: CostData): string {
  if (cost.total_usd < 0.01) {
    return `$${(cost.total_usd * 100).toFixed(4)}¢`;
  }
  return `$${cost.total_usd.toFixed(4)}`;
}
