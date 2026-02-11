/**
 * OpenAI Compatible Route
 * 
 * Proxies requests to OpenAI API with token metering.
 * Endpoint: POST /v1/chat/completions
 * 
 * Reference: https://platform.openai.com/docs/api-reference/chat/create
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { 
  countOpenAITokens, 
  countTokens, 
  extractOpenAIUsage,
  type TokenUsage 
} from '../tokenCounter.js';
import { AgentSigner, type SignedPayload } from '../signer.js';
import { getRecorder } from '../onchain.js';

const OPENAI_API_BASE = 'https://api.openai.com';

export interface OpenAIRouteConfig {
  apiKey?: string;
  signer: AgentSigner;
  logRequests?: boolean;
}

interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string | null;
    name?: string;
    function_call?: any;
    tool_calls?: any[];
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  n?: number;
  functions?: any[];
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
  seed?: number;
  user?: string;
}

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      function_call?: any;
      tool_calls?: any[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function createOpenAIRouter(config: OpenAIRouteConfig): Hono {
  const router = new Hono();
  const { signer, logRequests = true } = config;

  /**
   * POST /v1/chat/completions
   */
  router.post('/chat/completions', async (c) => {
    const startTime = Date.now();
    
    // Get API key from header or config
    const authHeader = c.req.header('Authorization');
    const apiKey = authHeader?.replace('Bearer ', '') || config.apiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return c.json({ error: { message: 'Missing API key', type: 'invalid_request_error' } }, 401);
    }

    // Parse request body
    let body: ChatCompletionRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }, 400);
    }

    // Calculate input tokens
    const inputTokens = countOpenAITokens(body.messages, body.model);
    
    if (logRequests) {
      console.log(`[openai] ${body.model} | input: ${inputTokens} tokens | stream: ${body.stream ?? false}`);
    }

    // Handle streaming
    if (body.stream) {
      return handleStreamingRequest(c, body, apiKey, inputTokens, signer);
    }

    // Non-streaming request
    try {
      const response = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        return c.json(error, response.status as any);
      }

      const data = await response.json();
      
      // Extract usage from response
      const usage = extractOpenAIUsage(data);
      
      // Sign the usage
      const signedPayload = signer.signUsage(
        body,
        usage.inputTokens,
        usage.outputTokens,
        usage.model
      );

      // Record to chain (async, don't block response)
      const recorder = getRecorder();
      const recordResult = await recorder.record(signedPayload);

      if (logRequests) {
        const duration = Date.now() - startTime;
        console.log(`[openai] ${usage.model} | in: ${usage.inputTokens} out: ${usage.outputTokens} | ${duration}ms`);
      }

      // Add AXLE headers
      c.header('x-axle-tokens-input', usage.inputTokens.toString());
      c.header('x-axle-tokens-output', usage.outputTokens.toString());
      c.header('x-axle-signature', signedPayload.signature);
      c.header('x-axle-agent-id', signedPayload.agentId);
      if (recordResult.txId && recordResult.txId !== 'batched') {
        c.header('x-axle-tx-id', recordResult.txId);
      }

      return c.json(data);
    } catch (error: any) {
      console.error('[openai] Request failed:', error.message);
      return c.json({ 
        error: { message: error.message, type: 'api_error' } 
      }, 500);
    }
  });

  /**
   * GET /v1/models - List models (passthrough)
   */
  router.get('/models', async (c) => {
    const authHeader = c.req.header('Authorization');
    const apiKey = authHeader?.replace('Bearer ', '') || config.apiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return c.json({ error: { message: 'Missing API key', type: 'invalid_request_error' } }, 401);
    }

    const response = await fetch(`${OPENAI_API_BASE}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const data = await response.json();
    return c.json(data, response.status as any);
  });

  return router;
}

/**
 * Handle streaming response
 */
async function handleStreamingRequest(
  c: any,
  body: ChatCompletionRequest,
  apiKey: string,
  inputTokens: number,
  signer: AgentSigner
) {
  const response = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream_options: { include_usage: true } }),
  });

  if (!response.ok) {
    const error = await response.json();
    return c.json(error, response.status);
  }

  // Set headers for SSE
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('x-axle-agent-id', signer.agentId);
  c.header('x-axle-tokens-input', inputTokens.toString());

  return stream(c, async (stream) => {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let outputTokens = 0;
    let model = body.model;
    let contentBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Calculate final signature
            const signedPayload = signer.signUsage(
              body,
              inputTokens,
              outputTokens,
              model
            );

            // Send usage event before DONE
            await stream.write(`data: ${JSON.stringify({
              axle: {
                inputTokens,
                outputTokens,
                signature: signedPayload.signature,
                agentId: signedPayload.agentId,
              }
            })}\n\n`);

            // Record to chain
            const recorder = getRecorder();
            recorder.record(signedPayload);

            await stream.write('data: [DONE]\n\n');
            continue;
          }

          try {
            const chunk: StreamChunk = JSON.parse(data);
            model = chunk.model || model;
            
            // Track output tokens from content
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              contentBuffer += content;
            }

            // Use usage if provided (with stream_options)
            if (chunk.usage) {
              outputTokens = chunk.usage.completion_tokens;
            }
          } catch {
            // Ignore parse errors
          }

          await stream.write(line + '\n\n');
        }
      }

      // Calculate tokens from content if not provided
      if (outputTokens === 0 && contentBuffer) {
        outputTokens = countTokens(contentBuffer, model);
      }
    } finally {
      reader.releaseLock();
    }
  });
}

export default createOpenAIRouter;
