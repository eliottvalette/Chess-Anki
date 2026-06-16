'use client';

import { useLabOrchestrator } from './lab/useLabOrchestrator';
import { LabProvider } from './lab/LabContext';
import { LabBoardArea } from './lab/board/LabBoardArea';
import { LabSidebar } from './lab/sidebar/LabSidebar';

export function ChessAnalysisLab() {
  const orchestrator = useLabOrchestrator();

  return (
    <LabProvider value={orchestrator}>
      <main className={orchestrator.pageClassName}>
        <LabBoardArea />
        <LabSidebar />
      </main>
    </LabProvider>
  );
}
