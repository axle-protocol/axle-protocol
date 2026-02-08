export type RiskFlag =
  | 'MONEY'
  | 'ADDRESS'
  | 'ACCOUNT'
  | 'LINK'
  | 'SEXUAL_CONSENT'
  | 'HATE_HARASSMENT'
  | 'ILLEGAL'
  | 'SELF_HARM'
  | 'OTHER';

export type ReplyJson = {
  replyCandidates: [string, string, string];
  bestReply: string;
  rationale: string;
  riskFlags: RiskFlag[];
  shouldBlock: boolean;
  blockReason: string;
};

export type PromptBundle = {
  trainingPrompt: string;
  autopilotPrompt: string;
  styleRulesMd: string;
  safetyPolicyMd: string;
};
