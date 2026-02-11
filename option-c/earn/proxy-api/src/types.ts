import { z } from "zod";

// Supported providers
export const ProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type Provider = z.infer<typeof ProviderSchema>;

// Chat message format
export const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

// Chat completion request
export const ChatCompletionRequestSchema = z.object({
  provider: ProviderSchema,
  model: z.string(),
  messages: z.array(MessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// Usage data from provider
export interface ProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Cost calculation
export interface CostData {
  input_usd: number;
  output_usd: number;
  total_usd: number;
  total_lamports: number;
}

// Signed usage data (for signature generation)
export interface SignedUsageData {
  version: 1;
  task_id: string | null;
  agent_wallet: string;
  provider: Provider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_lamports: number;
  timestamp: number;
  nonce: string;
}

// AXLE-specific response data
export interface AxleResponseData {
  task_id: string | null;
  agent_wallet: string;
  provider: Provider;
  model: string;
  cost: CostData;
  timestamp: number;
  nonce: string;
  signature: string;
}

// Chat completion response
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length" | "content_filter";
  }>;
  usage: ProviderUsage;
  axle: AxleResponseData;
}

// Usage record stored in database
export interface UsageRecord {
  id: string;
  task_id: string | null;
  agent_wallet: string;
  provider: Provider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_lamports: number;
  timestamp: number;
  signature: string;
  settled: boolean;
  tx_signature: string | null;
}

// Model pricing (per 1K tokens)
export interface ModelPricing {
  input: number; // USD per 1K tokens
  output: number; // USD per 1K tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4-turbo-preview": { input: 0.01, output: 0.03 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-4-32k": { input: 0.06, output: 0.12 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "gpt-3.5-turbo-16k": { input: 0.003, output: 0.004 },

  // Anthropic
  "claude-3-opus-20240229": { input: 0.015, output: 0.075 },
  "claude-3-sonnet-20240229": { input: 0.003, output: 0.015 },
  "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },

  // Google
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },
};

// SOL price assumption (update dynamically in production)
export const SOL_PRICE_USD = 200;
export const LAMPORTS_PER_SOL = 1_000_000_000;
