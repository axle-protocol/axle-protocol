/**
 * generateReply.ts — LLM을 호출하여 답장 후보 생성
 * 
 * 프롬프트 템플릿: docs/LLM_PROMPTS.md 기반
 * 스타일 룰: docs/STYLE_RULES_KR.md 기반
 * 안전 정책: docs/SAFETY_POLICY.md 기반
 */

import type { ReplyJson, RiskFlag, PromptBundle } from './types.js';
import { parseAndValidateReplyJson } from './validate.js';

export type PartnerProfile = {
  partnerId: string;
  nickname: string;
  mbti?: string;
  relationStage: 'some' | 'lover'; // 썸 or 연인
  styleMode: 'myStyle' | 'sweet' | 'cool' | 'empathy';
  toggles: {
    laughStyle: 'off' | 'low' | 'high'; // ㅋㅋ/ㅎㅎ
    emoji: 'off' | 'low' | 'high';
    lineBreak: 'oneLine' | 'twoLine' | 'choppy';
    typo: 'keep' | 'medium' | 'clean';
    length: 'S' | 'M' | 'L';
    flirtLevel: 0 | 1 | 2 | 3;
  };
  sampleMessages?: string[]; // 내 말투 샘플 (최대 30개)
};

export type IncomingMessage = {
  from: string;
  text: string;
  atMs: number;
};

export type GenerateOptions = {
  mode: 'training' | 'autopilot';
  messages: IncomingMessage[];
  profile: PartnerProfile;
  prompts: PromptBundle;
  apiKey: string;
  model?: string; // default: claude-3-5-sonnet
};

/**
 * 프롬프트 조립
 */
function buildPrompt(opts: GenerateOptions): string {
  const { mode, messages, profile, prompts } = opts;
  
  const basePrompt = mode === 'training' 
    ? prompts.trainingPrompt 
    : prompts.autopilotPrompt;

  // 최근 메시지 (최대 10개)
  const recentMessages = messages.slice(-10).map(m => 
    `[${new Date(m.atMs).toLocaleTimeString('ko-KR')}] ${m.from}: ${m.text}`
  ).join('\n');

  // 스타일 설정
  const styleConfig = `
## 스타일 설정
- 모드: ${profile.styleMode}
- 관계: ${profile.relationStage === 'some' ? '썸' : '연인'}
- MBTI: ${profile.mbti || '미설정'}
- ㅋㅋ/ㅎㅎ: ${profile.toggles.laughStyle}
- 이모지: ${profile.toggles.emoji}
- 줄바꿈: ${profile.toggles.lineBreak}
- 오타: ${profile.toggles.typo}
- 길이: ${profile.toggles.length}
- 플러팅: ${profile.toggles.flirtLevel}/3
`;

  // 말투 샘플
  const sampleSection = profile.sampleMessages?.length 
    ? `\n## 내 말투 샘플\n${profile.sampleMessages.slice(0, 10).map(s => `- "${s}"`).join('\n')}`
    : '';

  return `${basePrompt}

${styleConfig}
${sampleSection}

## 최근 대화
${recentMessages}

## 스타일 가이드
${prompts.styleRulesMd}

## 안전 정책
${prompts.safetyPolicyMd}

---
위 대화에 대한 답장을 생성해주세요. JSON 형식으로 출력:
{
  "replyCandidates": ["후보1", "후보2", "후보3"],
  "bestReply": "최선의 답장",
  "rationale": "선택 이유 1줄",
  "riskFlags": [],
  "shouldBlock": false,
  "blockReason": ""
}`;
}

/**
 * Claude API 호출 (Anthropic)
 */
async function callClaude(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  
  if (!content) {
    throw new Error('Empty response from Claude');
  }

  return content;
}

/**
 * JSON 추출 (마크다운 코드블록 처리)
 */
function extractJson(raw: string): string {
  // ```json ... ``` 블록 추출
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }
  
  // 그냥 JSON으로 시작하면 그대로
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }
  
  throw new Error('No JSON found in response');
}

/**
 * 답장 생성 메인 함수
 */
export async function generateReply(opts: GenerateOptions): Promise<ReplyJson> {
  const prompt = buildPrompt(opts);
  const model = opts.model || 'claude-3-5-sonnet-20241022';
  
  const raw = await callClaude(prompt, opts.apiKey, model);
  const jsonStr = extractJson(raw);
  const reply = parseAndValidateReplyJson(jsonStr);
  
  return reply;
}

/**
 * 빠른 안전 체크 (LLM 호출 전 로컬 필터)
 */
export function quickSafetyCheck(text: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  
  // 금칙어 패턴
  const patterns: { pattern: RegExp; flag: RiskFlag }[] = [
    { pattern: /계좌|송금|입금|돈\s*보내/i, flag: 'MONEY' },
    { pattern: /주소\s*알려|어디\s*살|집\s*위치/i, flag: 'ADDRESS' },
    { pattern: /계정|비밀번호|아이디\s*뭐/i, flag: 'ACCOUNT' },
    { pattern: /https?:\/\/|링크\s*보낼/i, flag: 'LINK' },
    { pattern: /섹스|잠자리|같이\s*자/i, flag: 'SEXUAL_CONSENT' },
  ];
  
  for (const { pattern, flag } of patterns) {
    if (pattern.test(text)) {
      flags.push(flag);
    }
  }
  
  return flags;
}
