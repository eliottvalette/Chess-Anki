import { useCallback, useEffect, useRef } from 'react';
import { CHESS_SOUND_URLS, type ChessSoundKey } from '@/lib/chess-sounds';

export function useLabAudio() {
  const soundPlayersRef = useRef<Partial<Record<ChessSoundKey, HTMLAudioElement>>>({});
  const sequenceTimersRef = useRef<number[]>([]);

  const ensureSoundPlayer = useCallback((soundKey: ChessSoundKey) => {
    const existing = soundPlayersRef.current[soundKey];

    if (existing) {
      return existing;
    }

    const audio = new Audio(CHESS_SOUND_URLS[soundKey]);
    audio.preload = 'auto';
    soundPlayersRef.current[soundKey] = audio;
    return audio;
  }, []);

  const playSound = useCallback(
    (soundKey: ChessSoundKey) => {
      const base = ensureSoundPlayer(soundKey);
      const player = base.cloneNode(true) as HTMLAudioElement;
      player.currentTime = 0;
      void player.play().catch(() => undefined);
    },
    [ensureSoundPlayer],
  );

  const cancelSoundSequence = useCallback(() => {
    for (const timer of sequenceTimersRef.current) {
      window.clearTimeout(timer);
    }

    sequenceTimersRef.current = [];
  }, []);

  const playSoundSequence = useCallback(
    (soundKeys: ChessSoundKey[]) => {
      soundKeys.forEach((soundKey, index) => {
        const timer = window.setTimeout(() => {
          sequenceTimersRef.current = sequenceTimersRef.current.filter((entry) => entry !== timer);
          playSound(soundKey);
        }, index * 110);

        sequenceTimersRef.current.push(timer);
      });
    },
    [playSound],
  );

  useEffect(() => cancelSoundSequence, [cancelSoundSequence]);

  return {
    cancelSoundSequence,
    playSound,
    playSoundSequence,
  };
}
