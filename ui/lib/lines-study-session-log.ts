import type { OpeningSide } from './opening-tree.ts';

export type LinesStudySessionEntry = {
  at: string;
  kind: string;
  detail: Record<string, string | number | boolean | string[]>;
};

export type LinesStudySessionLog = {
  startedAt: string;
  treeId: string | null;
  mode: 'learn' | 'review' | null;
  trainSide: OpeningSide | null;
  entries: LinesStudySessionEntry[];
};

export function createLinesStudySessionLog(
  treeId: string,
  mode: 'learn' | 'review',
  trainSide: OpeningSide,
): LinesStudySessionLog {
  const startedAt = new Date().toISOString();

  return {
    startedAt,
    treeId,
    mode,
    trainSide,
    entries: [
      {
        at: startedAt,
        kind: 'session_start',
        detail: { treeId, mode, trainSide },
      },
    ],
  };
}

export function appendLinesStudySessionEntry(
  log: LinesStudySessionLog,
  kind: string,
  detail: Record<string, string | number | boolean | string[]>,
): LinesStudySessionLog {
  return {
    ...log,
    entries: [
      ...log.entries,
      {
        at: new Date().toISOString(),
        kind,
        detail,
      },
    ],
  };
}

function formatEntryDetail(detail: LinesStudySessionEntry['detail']) {
  return Object.entries(detail)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}=[${value.join(', ')}]`;
      }

      return `${key}=${value}`;
    })
    .join(' · ');
}

export function formatLinesStudySessionLog(log: LinesStudySessionLog | null) {
  if (!log) {
    return 'session log: (none — start Learn or Review first)';
  }

  const lines: string[] = [
    '--- session since training start ---',
    `started: ${log.startedAt}`,
    `tree: ${log.treeId ?? '?'}`,
    `mode: ${log.mode ?? '?'} · train ${log.trainSide ?? '?'}`,
    `events (${log.entries.length}):`,
  ];

  for (const [index, entry] of log.entries.entries()) {
    lines.push(`  ${index + 1}. ${entry.at} · ${entry.kind} · ${formatEntryDetail(entry.detail)}`);
  }

  return lines.join('\n');
}
