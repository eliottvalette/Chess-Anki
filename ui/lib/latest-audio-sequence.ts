export type ActiveAudioPlayer = {
  stop: () => void;
};

export type AudioSequenceOptions<Sound, Timer> = {
  clearTimer: (timer: Timer) => void;
  schedule: (callback: () => void, delayMs: number) => Timer;
  startSound: (sound: Sound, onEnded: () => void) => ActiveAudioPlayer;
  stepDelayMs?: number;
};

export class LatestAudioSequence<Sound, Timer> {
  private readonly activePlayers = new Set<ActiveAudioPlayer>();
  private readonly pendingTimers = new Set<Timer>();
  private readonly options: AudioSequenceOptions<Sound, Timer>;
  private readonly stepDelayMs: number;

  constructor(options: AudioSequenceOptions<Sound, Timer>) {
    this.options = options;
    this.stepDelayMs = options.stepDelayMs ?? 110;
  }

  play(sound: Sound) {
    this.cancel();
    this.start(sound);
  }

  playSequence(sounds: Sound[]) {
    this.cancel();

    const [firstSound, ...remainingSounds] = sounds;

    if (firstSound === undefined) {
      return;
    }

    this.start(firstSound);

    remainingSounds.forEach((sound, index) => {
      const timer = this.options.schedule(
        () => {
          this.pendingTimers.delete(timer);
          this.start(sound);
        },
        (index + 1) * this.stepDelayMs,
      );
      this.pendingTimers.add(timer);
    });
  }

  cancel() {
    for (const timer of this.pendingTimers) {
      this.options.clearTimer(timer);
    }
    this.pendingTimers.clear();

    for (const player of [...this.activePlayers]) {
      player.stop();
    }
    this.activePlayers.clear();
  }

  private start(sound: Sound) {
    const state: { player?: ActiveAudioPlayer } = {};
    let ended = false;
    const onEnded = () => {
      ended = true;

      if (state.player) {
        this.activePlayers.delete(state.player);
      }
    };

    const player = this.options.startSound(sound, onEnded);
    state.player = player;

    if (!ended) {
      this.activePlayers.add(player);
    }
  }
}
