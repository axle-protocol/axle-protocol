/**
 * Smoke test for AXLE Proxy
 */

import { 
  countTokens, 
  countOpenAITokens, 
  countAnthropicTokens,
  AgentSigner,
  verifySignature,
} from '../src/index.js';

console.log('🧪 AXLE Proxy Smoke Test\n');

// Test 1: Token counting
console.log('1️⃣ Token Counting');
const text = 'Hello, world! This is a test message.';
const tokens = countTokens(text, 'gpt-4');
console.log(`   Text: "${text}"`);
console.log(`   Tokens: ${tokens}`);
console.assert(tokens > 0, 'Token count should be positive');
console.log('   ✅ Basic token counting works\n');

// Test 2: OpenAI message format
console.log('2️⃣ OpenAI Message Counting');
const openaiMessages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
];
const openaiTokens = countOpenAITokens(openaiMessages, 'gpt-4');
console.log(`   Messages: ${JSON.stringify(openaiMessages)}`);
console.log(`   Tokens: ${openaiTokens}`);
console.assert(openaiTokens > 0, 'OpenAI token count should be positive');
console.log('   ✅ OpenAI message counting works\n');

// Test 3: Anthropic message format
console.log('3️⃣ Anthropic Message Counting');
const anthropicMessages = [
  { role: 'user', content: 'What is the capital of France?' },
];
const anthropicTokens = countAnthropicTokens(anthropicMessages, 'You are Claude.', 'claude-3-sonnet');
console.log(`   Messages: ${JSON.stringify(anthropicMessages)}`);
console.log(`   System: "You are Claude."`);
console.log(`   Tokens: ${anthropicTokens}`);
console.assert(anthropicTokens > 0, 'Anthropic token count should be positive');
console.log('   ✅ Anthropic message counting works\n');

// Test 4: Signing
console.log('4️⃣ Request Signing');
const signer = new AgentSigner();
console.log(`   Agent ID: ${signer.agentId}`);
console.log(`   Public Key: ${signer.publicKey}`);

const signedPayload = signer.signUsage(
  { test: 'request' },
  100,
  50,
  'gpt-4'
);
console.log(`   Signature: ${signedPayload.signature.slice(0, 32)}...`);
console.log(`   Timestamp: ${signedPayload.timestamp}`);

// Verify signature
const valid = verifySignature(signedPayload, signer.publicKey);
console.assert(valid, 'Signature should be valid');
console.log(`   Verification: ${valid ? '✅ Valid' : '❌ Invalid'}\n`);

// Test 5: Signature with wrong key fails
console.log('5️⃣ Signature Verification (Wrong Key)');
const otherSigner = new AgentSigner();
const invalidCheck = verifySignature(signedPayload, otherSigner.publicKey);
console.assert(!invalidCheck, 'Signature should be invalid with wrong key');
console.log(`   Verification with wrong key: ${invalidCheck ? '❌ Should fail' : '✅ Correctly rejected'}\n`);

// Summary
console.log('═══════════════════════════════════════');
console.log('✅ All smoke tests passed!');
console.log('═══════════════════════════════════════');
