'use client';

import styles from './chess-analysis-lab.module.css';
import { LabBoardArea } from './lab/board/LabBoardArea';
import { LabProvider } from './lab/LabContext';
import { LabSidebar } from './lab/sidebar/LabSidebar';
import { useLabOrchestrator } from './lab/useLabOrchestrator';

export function ChessAnalysisLab() {
  const orchestrator = useLabOrchestrator();

  return (
    <LabProvider value={orchestrator}>
      <main className={orchestrator.pageClassName}>
        <div className={styles.appShell}>
          <LabBoardArea />
          <LabSidebar />
        </div>
      </main>
    </LabProvider>
  );
}
