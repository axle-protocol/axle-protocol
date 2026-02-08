// Step 5 placeholder: KakaoTalk Desktop integration.
//
// We will implement this via macOS UI automation (Peekaboo) once KakaoTalk is installed
// and logged in on the Mac mini.

export type KakaoIncoming = {
  chatName: string;
  from: string;
  text: string;
  atMs: number;
};

export type KakaoOutgoing = {
  chatName: string;
  text: string;
};

export interface KakaoAdapter {
  observe(): Promise<KakaoIncoming[]>; // poll new messages
  send(msg: KakaoOutgoing): Promise<void>;
}
