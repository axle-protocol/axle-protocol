/**
 * Token Counter - Accurate token measurement using tiktoken
 * 
 * Supports OpenAI and Anthropic token counting with model-specific encodings.
 */

import { Tiktoken, get_encoding } from 'tiktoken';

// Model to encoding mapping
const MODEL_ENCODINGS: Record<string, string> = {
  // OpenAI GPT-4 family
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-turbo-preview': 'cl100k_base',
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  // OpenAI GPT-3.5 family
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5-turbo-16k': 'cl100k_base',
  // Anthropic Claude family (use cl100k_base as approximation)
  'claude-3-opus': 'cl100k_base',
  'claude-3-sonnet': 'cl100k_base',
  'claude-3-haiku': 'cl100k_base',
  'claude-3-5-sonnet': 'cl100k_base',
  'claude-3-5-haiku': 'cl100k_base',
};

// Cache encoders to avoid re-initialization
const encoderCache = new Map<string, Tiktoken>();

function getEncoder(model: string): Tiktoken {
  // Normalize model name (remove version suffixes)
  const baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '');
  
  const encodingName = MODEL_ENCODINGS[baseModel] || 'cl100k_base';
  
  if (!encoderCache.has(encodingName)) {
    const encoder = get_encoding(encodingName as any);
    encoderCache.set(encodingName, encoder);
  }
  
  return encoderCache.get(encodingName)!;
}

/**
 * Count tokens for a single string
 */
export function countTokens(text: string, model: string = 'gpt-4'): number {
  if (!text) return 0;
  const encoder = getEncoder(model);
  return encoder.encode(text).length;
}

/**
 * Count tokens for OpenAI chat messages
 * Based on: https://platform.openai.com/docs/guides/text-generation/managing-tokens
 */
export function countOpenAITokens(
  messages: Array<{ role: string; content: string | null; name?: string }>,
  model: string = 'gpt-4'
): number {
  const encoder = getEncoder(model);
  
  // Token overhead per message varies by model
  const tokensPerMessage = model.startsWith('gpt-4') ? 3 : 4;
  const tokensPerName = model.startsWith('gpt-4') ? 1 : -1;
  
  let totalTokens = 0;
  
  for (const message of messages) {
    totalTokens += tokensPerMessage;
    
    if (message.content) {
      totalTokens += encoder.encode(message.content).length;
    }
    if (message.role) {
      totalTokens += encoder.encode(message.role).length;
    }
    if (message.name) {
      totalTokens += encoder.encode(message.name).length + tokensPerName;
    }
  }
  
  // Every reply is primed with assistant
  totalTokens += 3;
  
  return totalTokens;
}

/**
 * Count tokens for Anthropic messages
 * Anthropic uses a different format: system + messages array
 */
export function countAnthropicTokens(
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>,
  system?: string,
  model: string = 'claude-3-sonnet'
): number {
  const encoder = getEncoder(model);
  let totalTokens = 0;
  
  // Count system prompt
  if (system) {
    totalTokens += encoder.encode(system).length;
    totalTokens += 4; // System wrapper overhead
  }
  
  for (const message of messages) {
    // Role token
    totalTokens += encoder.encode(message.role).length + 2;
    
    // Content can be string or array of content blocks
    if (typeof message.content === 'string') {
      totalTokens += encoder.encode(message.content).length;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          totalTokens += encoder.encode(block.text).length;
        }
        // Image blocks estimated at ~765 tokens (based on Anthropic docs)
        if (block.type === 'image') {
          totalTokens += 765;
        }
      }
    }
  }
  
  return totalTokens;
}

/**
 * Token usage result
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
}

/**
 * Extract token usage from OpenAI response
 */
export function extractOpenAIUsage(response: any): TokenUsage {
  const usage = response.usage || {};
  return {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    model: response.model || 'unknown',
  };
}

/**
 * Extract token usage from Anthropic response
 */
export function extractAnthropicUsage(response: any): TokenUsage {
  const usage = response.usage || {};
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    model: response.model || 'unknown',
  };
}

/**
 * Verify reported usage against calculated tokens
 * Returns discrepancy if significant (>5%)
 */
export function verifyUsage(
  reported: TokenUsage,
  calculated: { inputTokens: number }
): { valid: boolean; discrepancy?: number } {
  if (reported.inputTokens === 0) {
    return { valid: true };
  }
  
  const diff = Math.abs(reported.inputTokens - calculated.inputTokens);
  const discrepancy = diff / reported.inputTokens;
  
  return {
    valid: discrepancy < 0.05,
    discrepancy: discrepancy > 0.05 ? discrepancy : undefined,
  };
}
