// Minimal typed wrapper around the Web Speech API's SpeechRecognition —
// it isn't in lib.dom.d.ts, and only the vendor-prefixed webkit* global
// exists in the browsers that matter here (Safari/Chrome; no unprefixed
// SpeechRecognition in Safari). Declared narrowly to just what's used.
export type SpeechRecognitionResultLike = { 0: { transcript: string }; isFinal: boolean };
export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
