const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'components/chess-analysis-lab.tsx');
const content = fs.readFileSync(srcPath, 'utf8');

// We find the index of "function createEmptyTrainSessionStats(): TrainSessionStats {"
const chopIndex = content.indexOf('function createEmptyTrainSessionStats(): TrainSessionStats {');

if (chopIndex === -1) {
  console.log('Chop index not found');
  process.exit(1);
}

const choppedContent = content.substring(0, chopIndex);

// Add imports for the chopped functions
const imports = `
import {
  createEmptyTrainSessionStats,
  createEmptyWorkspaceSnapshot,
  normalizeWorkspaceSnapshot,
  buildTimelineReviews,
  getPositionCacheKey,
  getPositionAnalysisProfileKey,
  getTimelinePositionCacheKey,
  mergeDeckProgress,
  dedupeBoardArrows,
  isOpponentTurnFromFen,
  normalizeDeckLoadError,
  readStoredTrainingUsername,
  readStoredTrainingPassword,
  persistTrainingUsername,
  persistTrainingPassword,
  persistTrainingCredentials,
  readCookie,
  writeCookie,
  deleteCookie,
  delay
} from '../lib/lab-helpers';
import {
  ImportIcon,
  FlipIcon,
  ArrowIcon,
  RefreshIcon,
  ResetIcon
} from './lab/lab-icons';
`;

// Insert the imports after the last import line
const lastImportIndex = choppedContent.lastIndexOf('import ');
const nextLineIndex = choppedContent.indexOf('\n', lastImportIndex);

const finalContent =
  choppedContent.substring(0, nextLineIndex + 1) + imports + choppedContent.substring(nextLineIndex + 1);

fs.writeFileSync(srcPath, finalContent);
console.log('Successfully chopped helpers');
