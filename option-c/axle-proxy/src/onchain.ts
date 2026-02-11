/**
 * On-chain Recorder - Write token usage to Solana
 * 
 * Records signed token usage attestations to the AXLE Protocol on Solana.
 * Supports batching for efficiency.
 */

import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { SignedPayload, hashData } from './signer.js';

export interface OnchainConfig {
  rpcUrl: string;
  programId?: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  enableRecording?: boolean;
}

export interface RecordResult {
  success: boolean;
  txId?: string;
  error?: string;
  slot?: number;
}

// Default config
const DEFAULT_CONFIG: OnchainConfig = {
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: process.env.AXLE_PROGRAM_ID || '4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82',
  commitment: 'confirmed',
  enableRecording: true,
};

/**
 * Batch of usage records pending submission
 */
interface UsageBatch {
  records: SignedPayload[];
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: number;
}

/**
 * On-chain Recorder
 * 
 * Batches token usage records and submits them to Solana.
 * Uses memo program for simple attestation until full program integration.
 */
export class OnchainRecorder {
  private connection: Connection;
  private config: OnchainConfig;
  private payer?: Keypair;
  private batch: UsageBatch;
  private batchTimeout?: NodeJS.Timeout;
  
  // Batch settings
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_TIMEOUT_MS = 30000; // 30 seconds
  
  constructor(config?: Partial<OnchainConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = new Connection(this.config.rpcUrl, this.config.commitment);
    this.batch = this.createEmptyBatch();
    
    // Initialize payer from environment
    const payerKey = process.env.SOLANA_PAYER_KEY;
    if (payerKey) {
      try {
        const keyBytes = bs58.decode(payerKey);
        this.payer = Keypair.fromSecretKey(keyBytes);
      } catch (e) {
        console.warn('Invalid SOLANA_PAYER_KEY, on-chain recording disabled');
      }
    }
  }

  private createEmptyBatch(): UsageBatch {
    return {
      records: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Record token usage (batched)
   */
  async record(payload: SignedPayload): Promise<RecordResult> {
    if (!this.config.enableRecording) {
      return { success: true, txId: 'disabled' };
    }

    // Add to batch
    this.batch.records.push(payload);
    this.batch.totalInputTokens += payload.inputTokens;
    this.batch.totalOutputTokens += payload.outputTokens;

    // Check if batch is full
    if (this.batch.records.length >= this.BATCH_SIZE) {
      return this.flushBatch();
    }

    // Set timeout for partial batch
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.flushBatch().catch(console.error);
      }, this.BATCH_TIMEOUT_MS);
    }

    return { success: true, txId: 'batched' };
  }

  /**
   * Immediately record without batching
   */
  async recordImmediate(payload: SignedPayload): Promise<RecordResult> {
    if (!this.config.enableRecording || !this.payer) {
      return { 
        success: !this.config.enableRecording,
        error: this.config.enableRecording ? 'No payer configured' : undefined,
        txId: 'disabled',
      };
    }

    try {
      const memo = this.createMemo([payload]);
      const txId = await this.submitMemo(memo);
      
      return {
        success: true,
        txId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Flush current batch to chain
   */
  async flushBatch(): Promise<RecordResult> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }

    if (this.batch.records.length === 0) {
      return { success: true, txId: 'empty' };
    }

    if (!this.payer) {
      const result = { 
        success: false, 
        error: 'No payer configured for on-chain recording' 
      };
      this.batch = this.createEmptyBatch();
      return result;
    }

    const currentBatch = this.batch;
    this.batch = this.createEmptyBatch();

    try {
      const memo = this.createMemo(currentBatch.records);
      const txId = await this.submitMemo(memo);
      
      console.log(`[onchain] Recorded ${currentBatch.records.length} usage records, tx: ${txId}`);
      
      return {
        success: true,
        txId,
      };
    } catch (error: any) {
      console.error('[onchain] Failed to record batch:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create memo data from usage records
   */
  private createMemo(records: SignedPayload[]): string {
    // Compact format: axle|v1|count|hash|totalIn|totalOut|timestamp
    const totalIn = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOut = records.reduce((sum, r) => sum + r.outputTokens, 0);
    
    // Hash all signatures together for verification
    const sigHash = hashData(records.map(r => r.signature).join(''));
    
    return [
      'axle',
      'v1',
      records.length.toString(),
      sigHash.slice(0, 16),
      totalIn.toString(),
      totalOut.toString(),
      Date.now().toString(36), // Base36 for compactness
    ].join('|');
  }

  /**
   * Submit memo transaction to Solana
   */
  private async submitMemo(memo: string): Promise<string> {
    if (!this.payer) {
      throw new Error('No payer keypair');
    }

    // Use Memo Program for simple attestation
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    
    const tx = new Transaction();
    tx.add({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf-8'),
    });

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.payer.publicKey;

    tx.sign(this.payer);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: this.config.commitment,
    });

    await this.connection.confirmTransaction(signature, this.config.commitment);

    return signature;
  }

  /**
   * Get connection status
   */
  async getStatus(): Promise<{ connected: boolean; slot?: number; error?: string }> {
    try {
      const slot = await this.connection.getSlot();
      return { connected: true, slot };
    } catch (error: any) {
      return { connected: false, error: error.message };
    }
  }

  /**
   * Get pending batch info
   */
  getPendingBatch(): { count: number; totalTokens: number } {
    return {
      count: this.batch.records.length,
      totalTokens: this.batch.totalInputTokens + this.batch.totalOutputTokens,
    };
  }

  /**
   * Close recorder and flush pending
   */
  async close(): Promise<void> {
    await this.flushBatch();
  }
}

// Singleton instance
let recorder: OnchainRecorder | null = null;

export function getRecorder(config?: Partial<OnchainConfig>): OnchainRecorder {
  if (!recorder) {
    recorder = new OnchainRecorder(config);
  }
  return recorder;
}
