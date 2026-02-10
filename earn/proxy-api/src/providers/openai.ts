import OpenAI from "openai";
import { ChatCompletionRequest, ProviderUsage } from "../types.js";

interface OpenAIResponse {
  content: string;
  usage: ProviderUsage;
  model: string;
  finish_reason: "stop" | "length" | "content_filter";
}

/**
 * Call OpenAI API
 */
export async function callOpenAI(
  request: ChatCompletionRequest
): Promise<OpenAIResponse> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.chat.completions.create({
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  });

  const choice = response.choices[0];
  if (!choice || !choice.message.content) {
    throw new Error("No response from OpenAI");
  }

  if (!response.usage) {
    throw new Error("No usage data from OpenAI");
  }

  return {
    content: choice.message.content,
    usage: {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    },
    model: response.model,
    finish_reason: choice.finish_reason as "stop" | "length" | "content_filter",
  };
}

/**
 * Stream OpenAI API response
 */
export async function* streamOpenAI(
  request: ChatCompletionRequest
): AsyncGenerator<{ content?: string; usage?: ProviderUsage; done?: boolean }> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const stream = await client.chat.completions.create({
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      yield { content: delta.content };
    }

    // Final chunk includes usage
    if (chunk.usage) {
      yield {
        usage: {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        },
        done: true,
      };
    }
  }
}
