import type { BoardPlayerSummary } from '../../../lib/lab-helpers';

function renderCapturedPieces(player: BoardPlayerSummary) {
  const pieceOccurrences = new Map<string, number>();

  return player.captured.map((piece: string) => {
    const occurrence = pieceOccurrences.get(piece) ?? 0;
    pieceOccurrences.set(piece, occurrence + 1);

    return (
      <span
        className="flex-[0_0_auto] text-[16px] leading-none ml-[-2px] text-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        key={`${player.name}-${piece}-${occurrence}`}
      >
        {piece}
      </span>
    );
  });
}

export function BoardPlayerBar({ player }: { player: BoardPlayerSummary }) {
  return (
    <div className="w-full flex items-center gap-[6px] py-0.5 text-(--text)">
      <span className="flex-[0_0_auto] flex items-center justify-center text-[18px] opacity-80" aria-hidden="true">
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="w-[20px] h-[20px] block rounded-[3px] object-cover" src={player.avatarUrl} />
        ) : player.color === 'white' ? (
          '♙'
        ) : (
          '♟'
        )}
      </span>
      <span className="min-w-0 flex items-baseline gap-[6px]">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] text-[rgba(245,248,255,0.92)]">
          {player.name}
        </span>
        {player.elo ? (
          <span className="flex-[0_0_auto] text-[12px] text-[rgba(245,248,255,0.42)]">({player.elo})</span>
        ) : null}
      </span>
      <span className="min-w-0 flex-[1_1_auto] flex items-center justify-start gap-[1px] overflow-hidden text-[rgba(226,232,240,0.7)]">
        {renderCapturedPieces(player)}
        {player.materialAdvantage > 0 ? (
          <span className="flex-[0_0_auto] ml-[7px] text-[12px] text-[rgba(245,248,255,0.42)]">
            +{player.materialAdvantage}
          </span>
        ) : null}
      </span>
    </div>
  );
}
