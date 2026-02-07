/**
 * Server-side wallet wrapper for Anchor — replaces missing `Wallet` export in Anchor 0.30
 */
import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export class ServerWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    for (const tx of txs) {
      if (tx instanceof Transaction) {
        tx.partialSign(this.payer);
      }
    }
    return txs;
  }
}
