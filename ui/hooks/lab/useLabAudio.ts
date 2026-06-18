import { useCallback, useRef } from 'react';
import { CHESS_SOUND_URLS, type ChessSoundKey } from '@/lib/chess-sounds';

export function useLabAudio() {
  const soundPlayersRef = useRef<Partial<Record<ChessSoundKey, HTMLAudioElement>>>({});

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

  const playSoundSequence = useCallback(
    (soundKeys: ChessSoundKey[]) => {
      soundKeys.forEach((soundKey, index) => {
        window.setTimeout(() => playSound(soundKey), index * 110);
      });
    },
    [playSound],
  );

  return {
    playSound,
    playSoundSequence,
  };
}
