import { handleText } from './handler.js';

const text = process.argv.slice(2).join(' ').trim();
const statePath = process.env.SOME_PANEL_STATE || '.state/telegram-panel.json';
const res = handleText(text, statePath);
if (!res.handled) {
  process.exit(2);
}
process.stdout.write(res.replyText ?? '');
