import { ChatCompletionRequest, Provider, ProviderUsage } from "../types.js";
import { callOpenAI, streamOpenAI } from "./openai.js";
import { callAnthropic, streamAnthropic } from "./anthropic.js";

interface ProviderResponse {
  content: string;
  usage: ProviderUsage;
  model: string;
  finish_reason: "stop" | "length" | "content_filter";
}

/**
 * Route request to appropriate provider
 */
export async function callProvider(
  request: ChatCompletionRequest
): Promise<ProviderResponse> {
  switch (request.provider) {
    case "openai":
      return callOpenAI(request);
    case "anthropic":
      return callAnthropic(request);
    case "google":
      throw new Error("Google provider not yet implemented");
    default:
      throw new Error(`Unknown provider: ${request.provider}`);
  }
}

/**
 * Route streaming request to appropriate provider
 */
export async function* streamProvider(
  request: ChatCompletionRequest
): AsyncGenerator<{ content?: string; usage?: ProviderUsage; done?: boolean }> {
  switch (request.provider) {
    case "openai":
      yield* streamOpenAI(request);
      break;
    case "anthropic":
      yield* streamAnthropic(request);
      break;
    case "google":
      throw new Error("Google streaming not yet implemented");
    default:
      throw new Error(`Unknown provider: ${request.provider}`);
  }
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(provider: Provider): boolean {
  switch (provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "google":
      return !!process.env.GOOGLE_API_KEY;
  }
}
