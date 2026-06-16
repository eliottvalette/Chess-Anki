'use client';

import '@xyflow/react/dist/style.css';

export type TrainSessionStats = {
  completed: number;
  hits: number;
  misses: number;
};

export type WorkspaceMode = 'review' | 'train' | 'lines';

export type TrainingDeckSummary = {
  id: string;
  name: string;
  description: string;
  ownerProfileId: string | null;
  cardCount: number;
  newCount: number;
  learningCount: number;
  dueCount: number;
  ignoredCount: number;
  isOwned: boolean;
  canManage: boolean;
};
