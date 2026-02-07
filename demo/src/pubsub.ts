/**
 * PubSub abstraction layer.
 * Uses Redis if available, falls back to in-process EventEmitter.
 */

import { EventEmitter } from 'events';

export interface PubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  close(): Promise<void>;
  readonly transport: 'redis' | 'memory';
}

// ============ In-Process PubSub (always works) ============

class MemoryPubSub implements PubSub {
  private emitter = new EventEmitter();
  readonly transport = 'memory' as const;

  async publish(channel: string, message: string): Promise<void> {
    // Small delay to simulate network
    await new Promise(r => setTimeout(r, 50));
    this.emitter.emit(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    this.emitter.on(channel, handler);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

// ============ Redis PubSub ============

class RedisPubSub implements PubSub {
  private pub: any;
  private sub: any;
  readonly transport = 'redis' as const;

  constructor(pub: any, sub: any) {
    this.pub = pub;
    this.sub = sub;
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.pub.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    await this.sub.subscribe(channel);
    this.sub.on('message', (ch: string, msg: string) => {
      if (ch === channel) handler(msg);
    });
  }

  async close(): Promise<void> {
    await this.sub.quit();
    await this.pub.quit();
  }
}

// ============ Factory ============

export async function createPubSub(): Promise<PubSub> {
  // Try Redis first if REDIS_URL is set
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const ioredis = await import('ioredis');
      const Redis = ioredis.default ?? ioredis;
      const pub = new (Redis as any)(redisUrl);
      const sub = new (Redis as any)(redisUrl);
      // Verify connection
      await pub.ping();
      console.log('[PubSub] Connected to Redis:', redisUrl);
      return new RedisPubSub(pub, sub);
    } catch (e: any) {
      console.log('[PubSub] Redis unavailable, falling back to in-memory:', e.message);
    }
  }

  console.log('[PubSub] Using in-memory transport');
  return new MemoryPubSub();
}

// Channel names
export const CHANNELS = {
  TASKS: 'axle:tasks',          // New task announcements
  AGENTS: 'axle:agents',        // Agent registration events
  EVENTS: 'axle:events',        // General protocol events
} as const;
