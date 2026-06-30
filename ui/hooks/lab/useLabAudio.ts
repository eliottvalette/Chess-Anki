import { useCallback, useEffect, useRef } from 'react';
import { CHESS_SOUND_URLS, type ChessSoundKey } from '@/lib/chess-sounds';
import { LatestAudioSequence } from '@/lib/latest-audio-sequence';

export function useLabAudio() {
  const soundPlayersRef = useRef<Partial<Record<ChessSoundKey, HTMLAudioElement>>>({});
  const audioSequenceRef = useRef<LatestAudioSequence<ChessSoundKey, number> | null>(null);

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

  const getAudioSequence = useCallback(() => {
    if (audioSequenceRef.current) {
      return audioSequenceRef.current;
    }

    audioSequenceRef.current = new LatestAudioSequence<ChessSoundKey, number>({
      clearTimer: (timer) => window.clearTimeout(timer),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      startSound: (soundKey, onEnded) => {
        const base = ensureSoundPlayer(soundKey);
        const player = base.cloneNode(true) as HTMLAudioElement;
        let finished = false;
        const finish = () => {
          if (finished) {
            return;
          }

          finished = true;
          player.removeEventListener('ended', finish);
          player.removeEventListener('error', finish);
          onEnded();
        };

        player.addEventListener('ended', finish);
        player.addEventListener('error', finish);
        player.currentTime = 0;
        void player.play().catch(finish);

        return {
          stop: () => {
            player.pause();
            player.currentTime = 0;
            finish();
          },
        };
      },
    });

    return audioSequenceRef.current;
  }, [ensureSoundPlayer]);

  const playSound = useCallback(
    (soundKey: ChessSoundKey) => {
      getAudioSequence().play(soundKey);
    },
    [getAudioSequence],
  );

  const cancelSoundSequence = useCallback(() => {
    audioSequenceRef.current?.cancel();
  }, []);

  const playSoundSequence = useCallback(
    (soundKeys: ChessSoundKey[]) => {
      getAudioSequence().playSequence(soundKeys);
    },
    [getAudioSequence],
  );

  useEffect(() => cancelSoundSequence, [cancelSoundSequence]);

  return {
    cancelSoundSequence,
    playSound,
    playSoundSequence,
  };
}
