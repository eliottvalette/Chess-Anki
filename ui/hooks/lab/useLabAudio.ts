import { useCallback, useEffect, useRef } from 'react';
import { CHESS_SOUND_URLS, type ChessSoundKey } from '@/lib/chess-sounds';

export function useLabAudio() {
  const soundPlayersRef = useRef<Partial<Record<ChessSoundKey, HTMLAudioElement>>>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const players = Object.fromEntries(
      Object.entries(CHESS_SOUND_URLS).map(([key, url]) => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return [key, audio];
      }),
    ) as Partial<Record<ChessSoundKey, HTMLAudioElement>>;

    soundPlayersRef.current = players;
  }, []);

  const playSound = useCallback((soundKey: ChessSoundKey) => {
    const base = soundPlayersRef.current[soundKey];

    if (!base) {
      return;
    }

    const player = base.cloneNode(true) as HTMLAudioElement;
    player.currentTime = 0;
    void player.play().catch(() => undefined);
  }, []);

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
