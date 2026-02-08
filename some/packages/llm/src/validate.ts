import type { ReplyJson, RiskFlag } from './types.js';

const RISK_FLAGS: RiskFlag[] = [
  'MONEY',
  'ADDRESS',
  'ACCOUNT',
  'LINK',
  'SEXUAL_CONSENT',
  'HATE_HARASSMENT',
  'ILLEGAL',
  'SELF_HARM',
  'OTHER'
];

export function parseAndValidateReplyJson(raw: string): ReplyJson {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error('Invalid JSON');
  }

  const errors: string[] = [];

  const c = obj?.replyCandidates;
  if (!Array.isArray(c) || c.length !== 3 || c.some((x: any) => typeof x !== 'string')) {
    errors.push('replyCandidates must be string[3]');
  }

  if (typeof obj?.bestReply !== 'string') errors.push('bestReply must be string');
  if (typeof obj?.rationale !== 'string') errors.push('rationale must be string');
  if (typeof obj?.shouldBlock !== 'boolean') errors.push('shouldBlock must be boolean');
  if (typeof obj?.blockReason !== 'string') errors.push('blockReason must be string');

  const rf = obj?.riskFlags;
  if (!Array.isArray(rf) || rf.some((x: any) => typeof x !== 'string' || !RISK_FLAGS.includes(x as RiskFlag))) {
    errors.push(`riskFlags must be RiskFlag[] (${RISK_FLAGS.join(',')})`);
  }

  if (obj?.shouldBlock === false && obj?.blockReason !== '') {
    errors.push('blockReason must be empty string when shouldBlock=false');
  }

  if (errors.length) {
    throw new Error('Schema validation failed: ' + errors.join('; '));
  }

  return obj as ReplyJson;
}
