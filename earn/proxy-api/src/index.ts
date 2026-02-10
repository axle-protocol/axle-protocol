import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { Keypair } from "@solana/web3.js";
import dotenv from "dotenv";

import {
  ChatCompletionRequestSchema,
  ChatCompletionResponse,
  AxleResponseData,
} from "./types.js";
import { callProvider, streamProvider, isProviderConfigured } from "./providers/index.js";
import { calculateCost } from "./pricing.js";
import { signUsageData, createSignedUsageData, loadServerKeypair } from "./signature.js";

// Load environment variables
dotenv.config();

// Initialize server keypair
const serverKeypair = loadServerKeypair();
console.log(`Server public key: ${serverKeypair.publicKey.toBase58()}`);

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());
app.use("*", prettyJSON());

// Health check
app.get("/", (c) => {
  return c.json({
    name: "AXLE Proxy API",
    version: "0.1.0",
    status: "healthy",
    signer: serverKeypair.publicKey.toBase58(),
  });
});

// Chat completions endpoint
app.post("/v1/chat/completions", async (c) => {
  // Get headers
  const agentWallet = c.req.header("X-Agent-Wallet");
  const taskId = c.req.header("X-Task-Id") || null;
  const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!agentWallet) {
    return c.json({ error: { code: "invalid_wallet", message: "X-Agent-Wallet header required" } }, 400);
  }

  if (!apiKey) {
    return c.json({ error: { code: "invalid_api_key", message: "Authorization header required" } }, 401);
  }

  // Parse and validate request body
  let request;
  try {
    const body = await c.req.json();
    request = ChatCompletionRequestSchema.parse(body);
  } catch (err) {
    return c.json({ error: { code: "invalid_request", message: "Invalid request body" } }, 400);
  }

  // Check provider configuration
  if (!isProviderConfigured(request.provider)) {
    return c.json({
      error: {
        code: "provider_error",
        message: `Provider ${request.provider} is not configured`,
      },
    }, 500);
  }

  // Handle streaming
  if (request.stream) {
    return handleStreamingRequest(c, request, agentWallet, taskId);
  }

  // Non-streaming request
  try {
    const startTime = Date.now();
    const response = await callProvider(request);
    const latency = Date.now() - startTime;

    // Calculate cost
    const cost = calculateCost(
      response.model,
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    );

    // Create and sign usage data
    const usageData = createSignedUsageData({
      taskId,
      agentWallet,
      provider: request.provider,
      model: response.model,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      costLamports: cost.total_lamports,
    });

    const signature = signUsageData(usageData, serverKeypair);

    // Build response
    const axleData: AxleResponseData = {
      task_id: taskId,
      agent_wallet: agentWallet,
      provider: request.provider,
      model: response.model,
      cost,
      timestamp: usageData.timestamp,
      nonce: usageData.nonce,
      signature,
    };

    const chatResponse: ChatCompletionResponse = {
      id: `axle_chat_${generateId()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: response.content,
          },
          finish_reason: response.finish_reason,
        },
      ],
      usage: response.usage,
      axle: axleData,
    };

    // Log for audit
    console.log(JSON.stringify({
      type: "usage",
      task_id: taskId,
      agent_wallet: agentWallet,
      provider: request.provider,
      model: response.model,
      tokens: response.usage.total_tokens,
      cost_usd: cost.total_usd,
      latency_ms: latency,
      signature,
    }));

    return c.json(chatResponse);
  } catch (err) {
    console.error("Provider error:", err);
    return c.json({
      error: {
        code: "provider_error",
        message: err instanceof Error ? err.message : "Unknown error",
      },
    }, 502);
  }
});

// Handle streaming request
async function handleStreamingRequest(
  c: any,
  request: ReturnType<typeof ChatCompletionRequestSchema.parse>,
  agentWallet: string,
  taskId: string | null
) {
  const id = `axle_chat_${generateId()}`;

  // Set SSE headers
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return c.stream(async (stream: any) => {
    try {
      let fullContent = "";

      for await (const chunk of streamProvider(request)) {
        if (chunk.content) {
          fullContent += chunk.content;
          await stream.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              choices: [{ delta: { content: chunk.content } }],
            })}\n\n`
          );
        }

        if (chunk.done && chunk.usage) {
          // Calculate cost
          const cost = calculateCost(
            request.model,
            chunk.usage.prompt_tokens,
            chunk.usage.completion_tokens
          );

          // Create and sign usage data
          const usageData = createSignedUsageData({
            taskId,
            agentWallet,
            provider: request.provider,
            model: request.model,
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            costLamports: cost.total_lamports,
          });

          const signature = signUsageData(usageData, serverKeypair);

          // Send final chunk with usage and signature
          await stream.write(
            `data: ${JSON.stringify({
              id,
              object: "chat.completion.chunk",
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: chunk.usage,
              axle: {
                task_id: taskId,
                agent_wallet: agentWallet,
                provider: request.provider,
                model: request.model,
                cost,
                timestamp: usageData.timestamp,
                nonce: usageData.nonce,
                signature,
              },
            })}\n\n`
          );
        }
      }

      await stream.write("data: [DONE]\n\n");
    } catch (err) {
      console.error("Streaming error:", err);
      await stream.write(
        `data: ${JSON.stringify({ error: { message: "Streaming error" } })}\n\n`
      );
    }
  });
}

// Usage records endpoint
app.get("/v1/usage/records", async (c) => {
  const wallet = c.req.query("wallet");
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (!wallet) {
    return c.json({ error: { code: "invalid_request", message: "wallet parameter required" } }, 400);
  }

  // TODO: Implement database query
  return c.json({
    records: [],
    summary: {
      total_requests: 0,
      total_tokens: 0,
      total_usd: 0,
      total_lamports: 0,
    },
  });
});

// Verify signature endpoint
app.get("/v1/usage/verify/:signature", async (c) => {
  const signature = c.req.param("signature");

  // TODO: Implement signature lookup and verification
  return c.json({
    valid: false,
    error: "Not implemented",
  });
});

// Generate short random ID
function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Start server
const port = parseInt(process.env.PORT || "3000");
console.log(`Starting AXLE Proxy API on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
