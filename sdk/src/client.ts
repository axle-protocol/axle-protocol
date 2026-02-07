/**
 * @axle-protocol/sdk — AxleClient convenience wrapper
 */

import { Keypair } from '@solana/web3.js';
import { AxleSDK } from './index.js';
import type { Task, Agent, TaskCreation } from './types.js';
import * as fs from 'fs';

export interface AxleClientConfig {
  cluster: 'devnet' | 'mainnet-beta' | 'localnet';
  keypairPath?: string;
  wallet?: Keypair;
  rpcUrl?: string;
}

export class AxleClient {
  private sdk: AxleSDK;

  constructor(config: AxleClientConfig) {
    this.sdk = new AxleSDK({
      cluster: config.cluster,
      rpcUrl: config.rpcUrl,
    });

    if (config.wallet) {
      this.sdk.loadKeypair(config.wallet);
    } else if (config.keypairPath) {
      const raw = JSON.parse(fs.readFileSync(config.keypairPath, 'utf-8'));
      const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
      this.sdk.loadKeypair(keypair);
    }
  }

  async registerAgent(nodeId: string, capabilities: string[], fee: number): Promise<string> {
    const agent = await this.sdk.registerAgent({ nodeId, capabilities, feePerTask: fee });
    return agent.publicKey;
  }

  async getTasks(filter?: { capability?: string; status?: string }): Promise<Task[]> {
    return this.sdk.listTasks(filter?.capability);
  }

  async acceptTask(taskPda: string): Promise<string> {
    const task = await this.sdk.acceptTask(taskPda);
    return task.id;
  }

  async deliverTask(taskPda: string, result: string): Promise<string> {
    const task = await this.sdk.deliverTask(taskPda, result);
    return task.id;
  }

  async createTask(params: TaskCreation): Promise<Task> {
    return this.sdk.createTask(params);
  }

  async getReputation(agentPublicKey: string): Promise<number> {
    const agent = await this.sdk.getAgent(agentPublicKey);
    return agent?.reputation ?? 0;
  }

  async getAgent(publicKey: string): Promise<Agent | null> {
    return this.sdk.getAgent(publicKey);
  }

  async findAgents(capability?: string): Promise<Agent[]> {
    return this.sdk.findAgents(capability);
  }

  /** Access the underlying AxleSDK for advanced usage */
  get inner(): AxleSDK {
    return this.sdk;
  }
}
