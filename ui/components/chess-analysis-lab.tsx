'use client';

import { LabBoardArea } from './lab/board/LabBoardArea';
import { LabProvider } from './lab/LabContext';
import { LabSidebar } from './lab/sidebar/LabSidebar';
import { useLabOrchestrator } from './lab/useLabOrchestrator';

export function ChessAnalysisLab() {
  const orchestrator = useLabOrchestrator();

  return (
    <LabProvider value={orchestrator}>
      <main className={orchestrator.pageClassName} style={orchestrator.pageStyle}>
        <div className="h-[calc(100svh-36px)] min-h-0 grid grid-cols-[minmax(620px,1fr)_minmax(360px,440px)] gap-[18px] overflow-hidden max-[1180px]:grid-cols-[minmax(520px,1fr)_minmax(330px,380px)] max-[980px]:h-auto max-[980px]:grid-cols-1 max-[980px]:overflow-visible max-[720px]:gap-3">
          <LabBoardArea />
          <LabSidebar />
        </div>
      </main>
    </LabProvider>
  );
}
