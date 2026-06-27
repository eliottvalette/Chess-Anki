export type LinesLoadingKind = 'catalog' | 'detail' | 'position';

export function formatLinesLoadingStatus({
  kind,
  browsePly,
  elapsedSeconds,
}: {
  kind: LinesLoadingKind;
  browsePly: number;
  elapsedSeconds: number;
}) {
  const label =
    kind === 'catalog'
      ? `Loading lines · ply ${browsePly}`
      : kind === 'position'
        ? 'Filtering position'
        : 'Opening line';
  return elapsedSeconds > 0 ? `${label} · ${elapsedSeconds}s` : label;
}
