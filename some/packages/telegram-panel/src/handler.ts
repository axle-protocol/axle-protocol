import { createSession, DEFAULT_PROFILE, type SomeModePreset } from '@some/runtime';
import { fmtEvent, fmtRunState } from './ko.js';
import { applyCommand, helpKo, parseCommand, type ParsedCommand } from './commands.js';
import { loadOrInit, save, type PanelPersisted } from './persist.js';

export type HandleResult = {
  handled: boolean;
  replyText?: string;
};

function fmtProfileKo(st: PanelPersisted): string {
  const p = st.profile;
  return [
    `스타일: ${p.modePreset}`,
    `길이: ${p.toggles.length} / 웃음(ㅋㅋ): ${p.toggles.laugh} / 이모지: ${p.toggles.emoji}`,
    `줄바꿈: ${p.toggles.lineBreak} / 플러팅: ${p.toggles.flirting} / 경계필터: ${p.toggles.boundaryFilter ? 'on' : 'off'}`
  ].join('\n');
}

function tailEvents(st: PanelPersisted, limit = 8): string {
  const start = Math.max(0, st.session.events.length - limit);
  return st.session.events.slice(start).map(fmtEvent).join('\n');
}

export function handleText(text: string, statePath: string): HandleResult {
  const cmd = parseCommand(text);
  if (!cmd) return { handled: false };

  if (cmd.kind === 'HELP') {
    return { handled: true, replyText: helpKo() };
  }

  if (cmd.kind === 'RESET') {
    const session = createSession({ approvalRequired: 20 });
    const st: PanelPersisted = { version: 1, session, profile: DEFAULT_PROFILE, cursor: 0 };
    save(statePath, st);
    return {
      handled: true,
      replyText: `세션 초기화 완료\n상태: ${fmtRunState(session.runState)}\n\n${fmtProfileKo(st)}\n\n${tailEvents(st)}`
    };
  }

  const st = loadOrInit(statePath, { approvalRequired: 20 });

  if (cmd.kind === 'STATUS') {
    return {
      handled: true,
      replyText: `상태: ${fmtRunState(st.session.runState)}\n\n${fmtProfileKo(st)}\n\n${tailEvents(st)}`
    };
  }

  // profile commands handled here (keep runtime pure for now)
  if (cmd.kind === 'SET_PRESET') {
    st.profile.modePreset = cmd.preset;
  } else if (cmd.kind === 'SET_LENGTH') {
    st.profile.toggles.length = cmd.length;
  } else if (cmd.kind === 'SET_LAUGH') {
    st.profile.toggles.laugh = cmd.laugh;
  } else if (cmd.kind === 'SET_EMOJI') {
    st.profile.toggles.emoji = cmd.emoji;
  } else {
    applyCommand(st.session, cmd as ParsedCommand);
  }

  save(statePath, st);

  return {
    handled: true,
    replyText: `상태: ${fmtRunState(st.session.runState)}\n\n${fmtProfileKo(st)}\n\n${tailEvents(st)}`
  };
}
