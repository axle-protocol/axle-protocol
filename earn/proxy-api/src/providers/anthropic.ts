import Anthropic from "@anthropic-ai/sdk";
import { ChatCompletionRequest, ProviderUsage, Message } from "../types.js";

interface AnthropicResponse {
  content: string;
  usage: ProviderUsage;
  model: string;
  finish_reason: "stop" | "length" | "content_filter";
}

/**
 * Convert messages to Anthropic format
 */
function convertMessages(
  messages: Message[]
): { system?: string; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content;
    } else {
      anthropicMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }
  }

  return { system, messages: anthropicMessages };
}

/**
 * Call Anthropic API
 */
export async function callAnthropic(
  request: ChatCompletionRequest
): Promise<AnthropicResponse> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { system, messages } = convertMessages(request.messages);

  const response = await client.messages.create({
    model: request.model,
    max_tokens: request.max_tokens || 1024,
    system,
    messages,
    temperature: request.temperature,
  });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Anthropic");
  }

  return {
    content: textContent.text,
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    model: response.model,
    finish_reason:
      response.stop_reason === "end_turn"
        ? "stop"
        : response.stop_reason === "max_tokens"
          ? "length"
          : "stop",
  };
}

/**
 * Stream Anthropic API response
 */
export async function* streamAnthropic(
  request: ChatCompletionRequest
): AsyncGenerator<{ content?: string; usage?: ProviderUsage; done?: boolean }> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { system, messages } = convertMessages(request.messages);

  const stream = client.messages.stream({
    model: request.model,
    max_tokens: request.max_tokens || 1024,
    system,
    messages,
    temperature: request.temperature,
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "message_start") {
      inputTokens = event.message.usage.input_tokens;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield { content: event.delta.text };
      }
    }

    if (event.type === "message_delta") {
      outputTokens = event.usage.output_tokens;
    }

    if (event.type === "message_stop") {
      yield {
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
        done: true,
      };
    }
  }
}
