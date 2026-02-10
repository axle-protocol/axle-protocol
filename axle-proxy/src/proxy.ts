/**
 * AXLE Protocol Proxy Server
 * 
 * Token-metered API proxy for AI agents on Solana.
 * Provides OpenAI and Anthropic compatible endpoints with:
 * - Accurate token counting
 * - Ed25519 request signing
 * - On-chain usage recording
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';

import { createOpenAIRouter } from './routes/openai.js';
import { createAnthropicRouter } from './routes/anthropic.js';
import { createSignerFromEnv, AgentSigner } from './signer.js';
import { getRecorder } from './onchain.js';

export interface ProxyConfig {
  port?: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  agentSecretKey?: string;
  enableOnchain?: boolean;
  logRequests?: boolean;
}

/**
 * Create and configure the proxy server
 */
export function createProxy(config: ProxyConfig = {}): Hono {
  const app = new Hono();
  
  // Initialize signer
  const signer = config.agentSecretKey 
    ? new AgentSigner(config.agentSecretKey)
    : createSignerFromEnv();
  
  console.log(`[proxy] Agent ID: ${signer.agentId}`);
  console.log(`[proxy] Public Key: ${signer.publicKey}`);

  // Middleware
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
    exposeHeaders: [
      'x-axle-tokens-input',
      'x-axle-tokens-output', 
      'x-axle-signature',
      'x-axle-agent-id',
      'x-axle-tx-id',
    ],
  }));

  if (config.logRequests !== false) {
    app.use('*', logger());
  }

  // Health check
  app.get('/', (c) => c.json({
    service: 'axle-proxy',
    version: '0.1.0',
    agentId: signer.agentId,
    publicKey: signer.publicKey,
    endpoints: {
      openai: '/v1/chat/completions',
      anthropic: '/v1/messages',
    },
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Status endpoint
  app.get('/status', async (c) => {
    const recorder = getRecorder();
    const chainStatus = await recorder.getStatus();
    const pendingBatch = recorder.getPendingBatch();

    return c.json({
      agent: {
        id: signer.agentId,
        publicKey: signer.publicKey,
      },
      chain: chainStatus,
      pending: pendingBatch,
    });
  });

  // Mount OpenAI routes at /v1
  const openaiRouter = createOpenAIRouter({
    apiKey: config.openaiApiKey,
    signer,
    logRequests: config.logRequests,
  });
  app.route('/v1', openaiRouter);

  // Mount Anthropic routes at /v1
  const anthropicRouter = createAnthropicRouter({
    apiKey: config.anthropicApiKey,
    signer,
    logRequests: config.logRequests,
  });
  app.route('/v1', anthropicRouter);

  // Fallback for unmatched v1 routes
  app.all('/v1/*', (c) => {
    return c.json({
      error: {
        message: `Unsupported endpoint: ${c.req.path}`,
        type: 'invalid_request_error',
      }
    }, 404);
  });

  return app;
}

/**
 * Start the proxy server
 */
export function startProxy(config: ProxyConfig = {}): void {
  const port = config.port || parseInt(process.env.PORT || '3700', 10);
  const app = createProxy(config);

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    AXLE Protocol Proxy                    ║
╠═══════════════════════════════════════════════════════════╣
║  OpenAI:    POST /v1/chat/completions                     ║
║  Anthropic: POST /v1/messages                             ║
║  Status:    GET  /status                                  ║
╚═══════════════════════════════════════════════════════════╝
`);

  serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`[proxy] Listening on http://localhost:${info.port}`);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[proxy] Shutting down...');
    const recorder = getRecorder();
    await recorder.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[proxy] Shutting down...');
    const recorder = getRecorder();
    await recorder.close();
    process.exit(0);
  });
}

// Run if executed directly (use CLI entry point instead)
// Start with: npx tsx src/proxy.ts or node --loader tsx src/proxy.ts
if (require.main === module) {
  startProxy({
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    enableOnchain: process.env.ENABLE_ONCHAIN !== 'false',
    logRequests: process.env.LOG_REQUESTS !== 'false',
  });
}

// Exports
export { AgentSigner, createSignerFromEnv } from './signer.js';
export { countTokens, countOpenAITokens, countAnthropicTokens } from './tokenCounter.js';
export { getRecorder, OnchainRecorder } from './onchain.js';
export type { TokenUsage } from './tokenCounter.js';
export type { SignedPayload } from './signer.js';
