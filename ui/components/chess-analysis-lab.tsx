'use client';

import { useLabOrchestrator } from './lab/useLabOrchestrator';
import { LabProvider } from './lab/LabContext';
import { LabBoardArea } from './lab/board/LabBoardArea';
import { LabSidebar } from './lab/sidebar/LabSidebar';
import styles from './chess-analysis-lab.module.css';

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
