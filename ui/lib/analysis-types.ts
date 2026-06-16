export type ScoreBound = 'exact' | 'lowerbound' | 'upperbound';

export type RelativeScore = {
  type: 'cp' | 'mate';
  value: number;
  bound: ScoreBound;
};

export type PerspectiveScore = {
  type: 'cp' | 'mate';
  value: number;
  bound?: ScoreBound;
};

export type RawWdl = {
  win: number;
  draw: number;
  loss: number;
};

export type PerspectiveWdl = {
  white: number;
  draw: number;
  black: number;
};

export type AnalysisResult = {
  bestMove: string | null;
  ponder: string | null;
  depth: number;
  seldepth: number | null;
  timeMs: number | null;
  nodes: number | null;
  nps: number | null;
  multipv: number;
  pv: string[];
  raw: string[];
  score: RelativeScore | null;
  whitePerspective: PerspectiveScore | null;
  wdl: RawWdl | null;
  whitePerspectiveWdl: PerspectiveWdl | null;
  lines: AnalysisLine[];
};

export type AnalyzeRequest = {
  fen?: string;
  initialFen?: string | null;
  moves?: string[];
  depth?: number;
  movetimeMs?: number;
  multipv?: number;
};

export type AnalysisLine = {
  multipv: number;
  bestMove: string | null;
  depth: number;
  pv: string[];
  score: RelativeScore | null;
  whitePerspective: PerspectiveScore | null;
};

export type TrainingProfile = {
  id: string;
  username: string;
  hasPassword?: boolean;
};

export type WorkspaceMode = 'review' | 'train' | 'lines';
