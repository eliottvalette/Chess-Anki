import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('components');

function patch(path, edits) {
  let content = readFileSync(resolve(root, path), 'utf8');
  for (const [from, to] of edits) {
    if (!content.includes(from)) {
      console.warn(`SKIP (not found) in ${path}: ${from.slice(0, 70)}...`);
      continue;
    }
    content = content.split(from).join(to);
    console.log(`OK in ${path}: ${from.slice(0, 50)}...`);
  }
  writeFileSync(resolve(root, path), content);
}

patch('chess-lab-panels.tsx', [
  [
    `import {
  labActionButton,
  labActiveSideTab,
  labCompactAction,
  labConfirmButton,
  labDangerButton,
  labDeckLibraryButton,
  labDeckLibraryButtonSelected,
  labDeckMenuButton,
  labDialogCloseButton,
  labFullWidthAction,
  labFullWidthSideTab,
  labMenuItem,
  labMenuItemDanger,
  labOpeningTreeButton,
  labPanelScroll,
  labPrimaryButton,
  labRecentGameButton,
  labRecentGameDraw,
  labRecentGameLoss,
  labRecentGameWin,
  labSideTabButton,
} from '@/components/lab/lab-ui-classes';

`,
    `import styles from './chess-analysis-lab.module.css';

`,
  ],
  ['`${labFullWidthAction} ${labPrimaryButton}`', '`${styles.action} ${styles.primary} ${styles.fullWidthAction}`'],
  ['`${labFullWidthAction} ${labDangerButton}`', '`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`'],
  [
    "`${labFullWidthSideTab} ${trainSide === 'white' ? labPrimaryButton : ''}`",
    "`${styles.action} ${styles.fullWidthAction} ${trainSide === 'white' ? styles.primary : ''}`",
  ],
  [
    "`${labFullWidthSideTab} ${trainSide === 'black' ? labPrimaryButton : ''}`",
    "`${styles.action} ${styles.fullWidthAction} ${trainSide === 'black' ? styles.primary : ''}`",
  ],
  ['className={labFullWidthAction}', 'className={`${styles.action} ${styles.fullWidthAction}`}'],
  [
    '`${labActionButton} ${labPrimaryButton} col-span-full`',
    '`${styles.action} ${styles.primary} ${styles.profileFormWide}`',
  ],
  [
    "`${labActionButton} col-span-full ${chesscomUsername.trim() && !recentGamesLoading ? labConfirmButton : ''}`",
    "`${styles.action} ${styles.inlineFormWide} ${chesscomUsername.trim() && !recentGamesLoading ? styles.confirmAction : ''}`",
  ],
  [
    "`${labSideTabButton} ${recentGameTimeClass === timeClass ? labPrimaryButton : 'w-full'}`",
    '`${styles.action} ${recentGameTimeClass === timeClass ? styles.primary : styles.secondary}`',
  ],
  ['className={labCompactAction}', 'className={styles.action}'],
  ['`${labCompactAction} ${labDangerButton}`', '`${styles.action} ${styles.deleteAction}`'],
  ['`${labCompactAction} ${labPrimaryButton}`', '`${styles.action} ${styles.primary}`'],
  [
    "`${labActionButton} ${coachReview?.bestMoveSan ? labConfirmButton : ''}`",
    '`${styles.action} ${styles.actionBest}`',
  ],
  ['`${labActionButton} ${labPrimaryButton}`', '`${styles.action} ${styles.primary}`'],
  [
    "`${labActionButton} col-span-full ${newDeckTitle.trim() && !deckActionLoading ? labConfirmButton : ''}`",
    "`${styles.action} ${styles.inlineFormWide} ${newDeckTitle.trim() && !deckActionLoading ? styles.confirmAction : ''}`",
  ],
  [
    "`${labOpeningTreeButton} ${tree.id === activeTreeId ? labActiveSideTab : ''}`",
    "`${styles.openingTreeItem} ${tree.id === activeTreeId ? styles.openingTreeItemActive : ''}`",
  ],
  ['className={labDeckMenuButton}', 'className={styles.deckLibraryMenuButton}'],
  ['className={labMenuItem}', 'className={styles.deckLibraryMenuOption}'],
  ['`${labMenuItem} ${labMenuItemDanger}`', '`${styles.deckLibraryMenuOption} ${styles.deckLibraryMenuOptionDanger}`'],
  ['className={labDialogCloseButton}', 'className={styles.iconButton}'],
  ['`${labActionButton} w-full`', '`${styles.action} ${styles.secondary}`'],
  [
    "`${labFullWidthAction} ${labPrimaryButton} ${reviewDeckSaveStatus === 'Saved' ? 'border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] text-[#d8f5cc]' : ''}`",
    "`${styles.action} ${styles.primary} ${styles.fullWidthAction} ${reviewDeckSaveStatus === 'Saved' ? styles.saveAdded : ''}`",
  ],
  [
    "`relative min-w-0 ${isSelected ? labDeckLibraryButtonSelected : ''}`",
    "`${styles.deckLibraryItemWrap} ${isSelected ? styles.activeDeckLibraryItemWrap : ''}`",
  ],
  [
    "`${labDeckLibraryButton} ${isSelected ? labDeckLibraryButtonSelected : ''}`",
    "`${styles.deckLibraryItem} ${isSelected ? styles.activeDeckLibraryItem : ''}`",
  ],
]);

patch('lab/sidebar/LabSidebar.tsx', [
  [
    `import { labModeTabButton, labActiveModeTab } from '../lab-ui-classes';

`,
    `import styles from '../../chess-analysis-lab.module.css';

`,
  ],
  [
    "`${labModeTabButton} ${lab.labState.mode === tabMode ? labActiveModeTab : ''}`",
    "`${styles.modeTab} ${lab.labState.mode === tabMode ? styles.activeModeTab : ''}`",
  ],
]);

patch('lab/board/LabBoardArea.tsx', [
  [
    `import { labIconButton } from '../lab-ui-classes';
`,
    `import styles from '../../chess-analysis-lab.module.css';
`,
  ],
  ['labIconButton', 'styles.iconButton'],
]);

console.log('Restore pass done. Patch recent games + scrollers manually if needed.');
