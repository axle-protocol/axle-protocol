import { parseAndValidateReplyJson } from './validate.js';

const raw = process.argv.slice(2).join(' ').trim();
if (!raw) {
  console.error('Usage: pnpm -C packages/llm validate "<json>"');
  process.exit(2);
}

try {
  const parsed = parseAndValidateReplyJson(raw);
  console.log('OK');
  console.log(JSON.stringify(parsed, null, 2));
} catch (e: any) {
  console.error(String(e?.message ?? e));
  process.exit(1);
}
