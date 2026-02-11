/**
 * Anthropic Compatible Route
 * 
 * Proxies requests to Anthropic API with token metering.
 * Endpoint: POST /v1/messages
 * 
 * Reference: https://docs.anthropic.com/en/api/messages
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { 
  countAnthropicTokens, 
  countTokens,
  extractAnthropicUsage,
  type TokenUsage 
} from '../tokenCounter.js';
import { AgentSigner, type SignedPayload } from '../signer.js';
import { getRecorder } from '../onchain.js';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicRouteConfig {
  apiKey?: string;
  signer: AgentSigner;
  logRequests?: boolean;
}

interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

interface MessagesRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
  }>;
  system?: string | Array<{ type: 'text'; text: string }>;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: {
    user_id?: string;
  };
  tools?: any[];
  tool_choice?: any;
}

interface StreamEvent {
  type: string;
  message?: any;
  index?: number;
  content_block?: any;
  delta?: any;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export function createAnthropicRouter(config: AnthropicRouteConfig): Hono {
  const router = new Hono();
  const { signer, logRequests = true } = config;

  /**
   * POST /v1/messages
   */
  router.post('/messages', async (c) => {
    const startTime = Date.now();
    
    // Get API key from header or config
    const apiKey = c.req.header('x-api-key') || config.apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      return c.json({ 
        type: 'error',
        error: { type: 'authentication_error', message: 'Missing API key' } 
      }, 401);
    }

    // Parse request body
    let body: MessagesRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ 
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Invalid JSON' } 
      }, 400);
    }

    // Extract system text
    const systemText = typeof body.system === 'string' 
      ? body.system 
      : body.system?.map(s => s.text).join('\n');

    // Calculate input tokens
    const inputTokens = countAnthropicTokens(body.messages, systemText, body.model);
    
    if (logRequests) {
      console.log(`[anthropic] ${body.model} | input: ${inputTokens} tokens | stream: ${body.stream ?? false}`);
    }

    // Handle streaming
    if (body.stream) {
      return handleStreamingRequest(c, body, apiKey, inputTokens, signer);
    }

    // Non-streaming request
    try {
      const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        return c.json(error, response.status as any);
      }

      const data = await response.json();
      
      // Extract usage from response
      const usage = extractAnthropicUsage(data);
      
      // Sign the usage
      const signedPayload = signer.signUsage(
        body,
        usage.inputTokens,
        usage.outputTokens,
        usage.model
      );

      // Record to chain (async)
      const recorder = getRecorder();
      const recordResult = await recorder.record(signedPayload);

      if (logRequests) {
        const duration = Date.now() - startTime;
        console.log(`[anthropic] ${usage.model} | in: ${usage.inputTokens} out: ${usage.outputTokens} | ${duration}ms`);
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
      console.error('[anthropic] Request failed:', error.message);
      return c.json({ 
        type: 'error',
        error: { type: 'api_error', message: error.message } 
      }, 500);
    }
  });

  return router;
}

/**
 * Handle streaming response (SSE)
 */
async function handleStreamingRequest(
  c: any,
  body: MessagesRequest,
  apiKey: string,
  inputTokens: number,
  signer: AgentSigner
) {
  const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
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
          // Forward all lines (including event: lines)
          if (line.startsWith('event:')) {
            await stream.write(line + '\n');
            continue;
          }
          
          if (!line.startsWith('data: ')) {
            if (line.trim()) await stream.write(line + '\n');
            continue;
          }
          
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event: StreamEvent = JSON.parse(data);
            
            // Track model from message_start
            if (event.type === 'message_start' && event.message?.model) {
              model = event.message.model;
            }
            
            // Track content for token counting
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              contentBuffer += event.delta.text || '';
            }

            // Capture final usage from message_delta
            if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens;
            }

            // On message_stop, add AXLE metadata
            if (event.type === 'message_stop') {
              // Calculate tokens if not provided
              if (outputTokens === 0 && contentBuffer) {
                outputTokens = countTokens(contentBuffer, model);
              }

              const signedPayload = signer.signUsage(
                body,
                inputTokens,
                outputTokens,
                model
              );

              // Send AXLE event before stop
              await stream.write('event: axle_usage\n');
              await stream.write(`data: ${JSON.stringify({
                inputTokens,
                outputTokens,
                signature: signedPayload.signature,
                agentId: signedPayload.agentId,
              })}\n\n`);

              // Record to chain
              const recorder = getRecorder();
              recorder.record(signedPayload);
            }
          } catch {
            // Ignore parse errors
          }

          await stream.write(line + '\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  });
}

export default createAnthropicRouter;
