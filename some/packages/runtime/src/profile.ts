export type SomeModePreset = 'default' | 'warm' | 'cool' | 'empathic';

export type SomeToggles = {
  length: 'S' | 'M' | 'L';
  laugh: 'off' | 'low' | 'high'; // ㅋㅋ/ㅎㅎ
  emoji: 'off' | 'low' | 'high';
  punctuation: 'calm' | 'normal' | 'strong';
  typoStyle: 'keep' | 'medium' | 'clean';
  lineBreak: 'oneLine' | 'twoLine' | 'choppy';
  flirting: 0 | 1 | 2 | 3;
  boundaryFilter: boolean; // 기본 true
};

export type SomeProfile = {
  modePreset: SomeModePreset;
  toggles: SomeToggles;
};

export const DEFAULT_PROFILE: SomeProfile = {
  modePreset: 'default',
  toggles: {
    length: 'M',
    laugh: 'low',
    emoji: 'off',
    punctuation: 'normal',
    typoStyle: 'keep',
    lineBreak: 'oneLine',
    flirting: 1,
    boundaryFilter: true
  }
};
