import type { GameMetadata, StoredMove } from './chess-analysis-client.ts';

export type LinesReviewTransfer = {
  fileName: string;
  historyIndex: number;
  initialFen: string | null;
  metadata: GameMetadata;
  moveHistory: StoredMove[];
  orientation: 'white' | 'black';
};

export function buildLinesReviewTransfer({
  initialFen,
  moves,
  trainSide,
  treeName,
  username,
}: {
  initialFen: string | null;
  moves: StoredMove[];
  trainSide: 'white' | 'black';
  treeName: string;
  username: string;
}): LinesReviewTransfer {
  const opening = treeName.trim() || 'Lines position';
  const playerName = username.trim() || (trainSide === 'white' ? 'White' : 'Black');

  return {
    fileName: opening,
    historyIndex: moves.length,
    initialFen,
    metadata: {
      event: 'Lines review',
      site: 'Chess Lab',
      date: '',
      round: '',
      whitePlayer: trainSide === 'white' ? playerName : 'White',
      whiteElo: '',
      blackPlayer: trainSide === 'black' ? playerName : 'Black',
      blackElo: '',
      result: '*',
      eco: '',
      opening,
    },
    moveHistory: [...moves],
    orientation: trainSide,
  };
}
