const fs = require('fs');
const path = require('path');

const srcPath = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/components/chess-lab-panels.tsx';
const outDir = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/components/lab/panels';
const srcCode = fs.readFileSync(srcPath, 'utf8');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// All major panels
const panels = [
  'LinesPanel',
  'ReviewPanel',
  'TrainPanel',
  'TrainingProfilePanel',
  'AnalyzePanel',
  'GameReviewPanel',
  'LearnPanel',
  'DeckPanel',
  'PgnImportDialog',
];

for (const panel of panels) {
  const fileName = panel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.tsx';

  // We keep the whole file, but we remove the `export` keyword from other panels
  // so they become internal to the file, and TS won't complain if they are unused.
  // Wait, if they are unused, ESLint might complain.
  // A safer way is to just let them be exported, but we only import what we need.
  // Actually, duplicating a 2000 line file 9 times is 18000 lines of code. It doesn't solve the "no file > 500 lines" rule for those files!
}
