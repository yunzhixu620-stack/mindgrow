"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeechSegment {
  speaker: "主持人" | "分析师";
  text: string;
  citationIndexes: number[];
}

export function useScriptSpeech(segments: SpeechSegment[]) {
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const runId = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const stop = useCallback(() => {
    runId.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setState("idle");
    setCurrentIndex(-1);
  }, [supported]);

  const speakFrom = useCallback((startIndex: number) => {
    if (!supported || !segments.length) return;
    window.speechSynthesis.cancel();
    const id = ++runId.current;
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^zh/i.test(voice.lang));
    const speak = (index: number) => {
      if (id !== runId.current) return;
      if (index >= segments.length) {
        setState("idle");
        setCurrentIndex(-1);
        return;
      }
      const segment = segments[index];
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.lang = "zh-CN";
      utterance.rate = segment.speaker === "主持人" ? 1.04 : 0.98;
      utterance.pitch = segment.speaker === "主持人" ? 1.03 : 0.94;
      if (voices.length) utterance.voice = voices[index % Math.min(voices.length, 2)];
      utterance.onstart = () => { setCurrentIndex(index); setState("playing"); };
      utterance.onend = () => speak(index + 1);
      utterance.onerror = () => { setState("idle"); setCurrentIndex(-1); };
      window.speechSynthesis.speak(utterance);
    };
    speak(Math.max(0, startIndex));
  }, [segments, supported]);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (state === "playing") {
      window.speechSynthesis.pause();
      setState("paused");
    } else if (state === "paused") {
      window.speechSynthesis.resume();
      setState("playing");
    } else {
      speakFrom(0);
    }
  }, [speakFrom, state, supported]);

  useEffect(() => stop, [stop]);
  return { supported, state, currentIndex, toggle, stop, playFrom: speakFrom };
}
