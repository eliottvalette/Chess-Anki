import { Chess } from 'chess.js';
import { buildDeterministicAnalyzeRequest } from './analysis-profile.ts';
import type { AnalysisResult } from './analysis-types.ts';

type AnalyzePosition = (payload: Parameters<typeof buildDeterministicAnalyzeRequest>[0]) => Promise<AnalysisResult>;
type ReviewCardSide = 'white' | 'black';

type VerifiedReviewCardAnswer = {
  answerUci: string;
  answerSan: string;
  referenceEvalCp: number | null;
};

export async function resolvePostMoveVerifiedReviewCardAnswer({
  fen,
  side,
  rootAnalysis,
  analyzePosition,
}: {
  fen: string;
  side: ReviewCardSide;
  rootAnalysis: AnalysisResult;
  analyzePosition: AnalyzePosition;
}): Promise<VerifiedReviewCardAnswer> {
  const candidates = getRootCandidateMoves(rootAnalysis).slice(0, 3);

  if (candidates.length === 0) {
    throw new Error('No candidate moves are available for this position.');
  }

  const verified = await Promise.all(
    candidates.map(async (answerUci) => {
      const chess = new Chess(fen);
      const move = chess.move({
        from: answerUci.slice(0, 2),
        to: answerUci.slice(2, 4),
        ...(answerUci[4] ? { promotion: answerUci[4] } : {}),
      });

      if (!move) {
        throw new Error(`Candidate move ${answerUci} is not legal in this position.`);
      }

      const analysis = await analyzePosition(buildDeterministicAnalyzeRequest({ fen: chess.fen() }));
      const scoreCp = scoreToCpForSide(analysis.whitePerspective, side);

      return {
        answerUci,
        answerSan: move.san,
        scoreCp,
      };
    }),
  );

  return verified.reduce<VerifiedReviewCardAnswer>(
    (best, candidate) => {
      if (best.referenceEvalCp == null) {
        return {
          answerUci: candidate.answerUci,
          answerSan: candidate.answerSan,
          referenceEvalCp: candidate.scoreCp,
        };
      }

      if (candidate.scoreCp != null && candidate.scoreCp > best.referenceEvalCp) {
        return {
          answerUci: candidate.answerUci,
          answerSan: candidate.answerSan,
          referenceEvalCp: candidate.scoreCp,
        };
      }

      return best;
    },
    {
      answerUci: verified[0]?.answerUci ?? candidates[0],
      answerSan: verified[0]?.answerSan ?? candidates[0],
      referenceEvalCp: verified[0]?.scoreCp ?? null,
    },
  );
}

function getRootCandidateMoves(rootAnalysis: AnalysisResult) {
  const candidates = new Set<string>();

  for (const line of rootAnalysis.lines) {
    const move = line.bestMove ?? line.pv[0] ?? null;

    if (move) {
      candidates.add(move);
    }
  }

  if (rootAnalysis.bestMove) {
    candidates.add(rootAnalysis.bestMove);
  }

  return [...candidates];
}

function scoreToCpForSide(score: AnalysisResult['whitePerspective'], side: ReviewCardSide) {
  if (!score) {
    return null;
  }

  const whiteScore = score.type === 'mate' ? Math.sign(score.value) * 100000 : score.value;
  return side === 'white' ? whiteScore : -whiteScore;
}
