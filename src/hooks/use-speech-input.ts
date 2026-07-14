"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function useSpeechInput(onText: (text: string) => void, language = "zh-CN") {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onText);
  const [isListening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);

  useEffect(() => { callbackRef.current = onText; }, [onText]);

  useEffect(() => {
    const SpeechRecognition = (window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
    setSupported(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (finalText.trim()) callbackRef.current(finalText.trim());
      setInterimText(interim);
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        "not-allowed": "麦克风权限未开启，请在浏览器地址栏允许麦克风",
        "audio-capture": "没有检测到可用麦克风",
        network: "语音识别网络暂不可用",
        "no-speech": "没有听到语音，请再试一次",
      };
      setError(messages[event.error] || "语音识别失败，请再试一次");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setInterimText("");
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [language]);

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      setError("当前浏览器不支持语音输入，请使用最新版 Chrome 或 Edge");
      return;
    }
    setError("");
    setInterimText("");
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      // Calling start twice can throw while the existing session is active.
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { supported, isListening, interimText, error, start, stop, toggle };
}
