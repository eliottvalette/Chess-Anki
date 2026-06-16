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
    <div className="w-full min-h-[34px] flex items-center gap-[9px] px-[2px] py-0 text-[var(--text)] min-h-[26px] gap-[7px]">
      <span
        className={`${'w-[30px] h-[30px] flex-[0_0_auto] grid place-items-center rounded-[6px] bg-[rgba(238,242,247,0.9)] text-[rgba(29,37,48,0.78)] text-[22px] leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] w-[26px] h-[26px] text-[18px]'} ${player.color === 'black' ? 'bg-[rgba(31,40,52,0.9)] text-[rgba(226,232,240,0.82)] shadow-[inset_0_0_0_1px_rgba(226,232,240,0.12)]' : ''}`}
        aria-hidden="true"
      >
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="w-full h-full block rounded-[inherit] object-cover" src={player.avatarUrl} />
        ) : player.color === 'white' ? (
          '♙'
        ) : (
          '♟'
        )}
      </span>
      <span className="min-w-0 flex items-baseline gap-[6px]">
        <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[550] text-[14px]">
          {player.name}
        </strong>
        {player.elo ? (
          <span className="flex-[0_0_auto] text-(--text-soft) text-[14px] font-[650] text-[12px]">({player.elo})</span>
        ) : null}
      </span>
      <span className="min-w-0 flex-[1_1_auto] flex items-center justify-start gap-[1px] overflow-hidden text-[rgba(226,232,240,0.7)]">
        {renderCapturedPieces(player)}
        {player.materialAdvantage > 0 ? (
          <span className="flex-[0_0_auto] ml-[7px] text-[var(--text-muted)] text-[14px] font-[550] text-[12px]">
            +{player.materialAdvantage}
          </span>
        ) : null}
      </span>
    </div>
  );
}
