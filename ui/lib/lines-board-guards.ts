export function isLinesBoardPlayAllowed(options: {
  mode: string;
  hasOpeningTree: boolean;
  linesStudyMode: 'idle' | 'learn' | 'review';
  linesLearnBranchComplete: boolean;
  deckPlaybackBusy: boolean;
}) {
  if (options.mode !== 'lines' || !options.hasOpeningTree || options.deckPlaybackBusy) {
    return true;
  }

  if (options.linesLearnBranchComplete) {
    return false;
  }

  return options.linesStudyMode !== 'idle';
}
