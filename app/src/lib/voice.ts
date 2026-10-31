import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { API_BASE, headers } from './api';
import type { ChatMessage } from './chat';

/** Hold-free voice notes: tap to record, tap to send. Transcribed server-side (smallest.ai). */
export function useVoiceNote(chatId: string | null, onSent: (m: ChatMessage) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  const start = useCallback(async () => {
    setError(null);
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission is off. Turn it on in settings to talk to FINN.');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setStartedAt(Date.now());
    setRecording(true);
  }, [recorder]);

  const stopAndSend = useCallback(
    async (context?: string) => {
      if (!chatId) return;
      setRecording(false);
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) return;
      setSending(true);
      try {
        const form = new FormData();
        form.append('audio', { uri, name: 'note.m4a', type: 'audio/m4a' } as unknown as Blob);
        const q = context ? `?context=${encodeURIComponent(context)}` : '';
        const res = await globalThis.fetch(`${API_BASE}/api/conversations/${chatId}/voice${q}`, {
          method: 'POST',
          headers: headers(),
          body: form,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
        onSent(await res.json());
      } catch (e: any) {
        setError(`Couldn't send that voice note: ${e?.message ?? 'network error'}`);
      } finally {
        setSending(false);
      }
    },
    [chatId, recorder, onSent],
  );

  return { supported: Platform.OS !== 'web', recording, sending, error, startedAt, start, stopAndSend };
}

/** Read a FINN reply aloud (smallest.ai TTS, cached per message on the server). */
export function useSpeech(chatId: string | null) {
  const player = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => () => player.current?.remove(), []);

  const toggle = useCallback(
    async (messageId: string) => {
      if (!chatId) return;
      if (playing === messageId) {
        player.current?.pause();
        setPlaying(null);
        return;
      }
      setLoading(messageId);
      try {
        const res = await globalThis.fetch(`${API_BASE}/api/conversations/${chatId}/messages/${messageId}/speech`, {
          method: 'POST',
          headers: headers(),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { url } = await res.json();
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        player.current?.remove();
        player.current = createAudioPlayer({ uri: `${API_BASE}${url}`, headers: headers() });
        player.current.addListener('playbackStatusUpdate', (s) => {
          if (s.didJustFinish) setPlaying(null);
        });
        player.current.play();
        setPlaying(messageId);
      } catch {
        setPlaying(null);
      } finally {
        setLoading(null);
      }
    },
    [chatId, playing],
  );

  return { playing, loading, toggle };
}
