import type { BoardPlayerSummary } from '../../../lib/lab-helpers';
import styles from '../../chess-analysis-lab.module.css';

export function BoardPlayerBar({ player }: { player: BoardPlayerSummary }) {
  return (
    <div className={styles.boardPlayerBar}>
      <span
        className={`${styles.boardPlayerAvatar} ${player.color === 'black' ? styles.boardPlayerAvatarDark : ''}`}
        aria-hidden="true"
      >
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className={styles.boardPlayerAvatarImage} src={player.avatarUrl} />
        ) : player.color === 'white' ? (
          '♙'
        ) : (
          '♟'
        )}
      </span>
      <span className={styles.boardPlayerIdentity}>
        <strong className={styles.boardPlayerName}>{player.name}</strong>
        {player.elo ? <span className={styles.boardPlayerElo}>({player.elo})</span> : null}
      </span>
      <span className={styles.boardCapturedPieces}>
        {player.captured.map((piece: string, captureIndex: number) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: captured pieces are append-only and can repeat
          <span className={styles.boardCapturedPiece} key={`${player.name}-${piece}-capture-${captureIndex}`}>
            {piece}
          </span>
        ))}
        {player.materialAdvantage > 0 ? (
          <span className={styles.boardMaterialAdvantage}>+{player.materialAdvantage}</span>
        ) : null}
      </span>
    </div>
  );
}
