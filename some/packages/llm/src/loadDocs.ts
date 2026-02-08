import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptBundle } from './types.js';

function repoRoot(): string {
  // packages/llm/src -> packages/llm -> packages -> some/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../..');
}

export type DocPaths = {
  prompts: string;
  styleRules: string;
  safetyPolicy: string;
};

export function defaultDocPaths(): DocPaths {
  const root = repoRoot();
  return {
    prompts: path.join(root, 'docs/LLM_PROMPTS.md'),
    styleRules: path.join(root, 'docs/STYLE_RULES_KR.md'),
    safetyPolicy: path.join(root, 'docs/SAFETY_POLICY.md')
  };
}

export function loadPromptBundle(paths: Partial<DocPaths> = {}): PromptBundle {
  const p = { ...defaultDocPaths(), ...paths };

  // If Opus hasn't produced them yet, fail loudly.
  const promptsMd = fs.readFileSync(p.prompts, 'utf-8');
  const styleRulesMd = fs.readFileSync(p.styleRules, 'utf-8');
  const safetyPolicyMd = fs.readFileSync(p.safetyPolicy, 'utf-8');

  const trainingPrompt = extractSection(promptsMd, 'Training Mode Prompt');
  const autopilotPrompt = extractSection(promptsMd, 'Autopilot Mode Prompt');

  return { trainingPrompt, autopilotPrompt, styleRulesMd, safetyPolicyMd };
}

function extractSection(md: string, heading: string): string {
  // Convention we ask Opus to follow: "## <heading>" blocks.
  const rx = new RegExp(`(^|\\n)##\\s+${escapeRx(heading)}\\s*\\n`, 'm');
  const m = md.match(rx);
  if (!m || m.index == null) {
    throw new Error(`Missing section: ## ${heading}`);
  }
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/\n##\s+/m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  if (!body) throw new Error(`Empty section: ## ${heading}`);
  return body;
}

function escapeRx(s: string) {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}
