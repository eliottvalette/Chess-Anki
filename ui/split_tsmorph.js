const { Project } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const srcPath = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/components/chess-lab-panels.tsx';
const outDir = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/components/lab/panels';

// Restore the original file before doing anything
const { execSync } = require('child_process');
execSync(`git checkout "${srcPath}"`);
execSync(`rm -rf "${outDir}" && mkdir -p "${outDir}"`);

const project = new Project();
const sourceFile = project.addSourceFileAtPath(srcPath);

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

const sharedExports = [
  'WorkspaceMode',
  'TrainingDeckSummary',
  'TrainSessionStats',
  'getModeLabel',
  'OpeningTreeGraphAutoFollow',
  'getDisplayEngineLines',
  'EngineLinesSection',
  'renderMoveFigurine',
  'buildMasteryGradeDistribution',
  'getMasteryToneClass',
  'getMasteryGradeClass',
  'formatNextReview',
  'getOpeningDisplayName',
  'DeckLibraryItem',
];

// Helper to copy imports
const importDecls = sourceFile.getImportDeclarations().map((d) => d.getText());
const importsText =
  importDecls.join('\n') +
  `\nimport styles from '../../chess-analysis-lab.module.css';\nimport * as Shared from './shared';\nexport * from './shared';\n\n`;

// 1. Create shared.tsx
let sharedCode = importDecls.join('\n') + `\nimport styles from '../../chess-analysis-lab.module.css';\n\n`;

sourceFile.getTypeAliases().forEach((ta) => {
  if (sharedExports.includes(ta.getName())) {
    sharedCode += 'export ' + ta.getText() + '\n\n';
  }
});

sourceFile.getFunctions().forEach((fn) => {
  if (sharedExports.includes(fn.getName())) {
    // Check if it already has export modifier
    if (!fn.hasExportKeyword()) {
      fn.setIsExported(true);
    }
    sharedCode += fn.getText() + '\n\n';
  }
});

const sharedFile = path.join(outDir, 'shared.tsx');
fs.writeFileSync(sharedFile, sharedCode);

// 2. Create panels
let barrelContent = `export * from './shared';\n`;

for (const panel of panels) {
  const fn = sourceFile.getFunction(panel);
  if (!fn) {
    console.log(`Panel ${panel} not found`);
    continue;
  }

  const code = fn.getText();
  // Instead of prefixing types used in signatures, which is hard with regex,
  // let's just emit `export * from './shared'` inside each file! Wait!
  // If we have `import * as Shared`, we need prefixing. But if we just export all shared items from './shared'
  // and import them using named imports, it's easier.
  // Actually, I can just use ts-morph to extract the nodes.
  fs.writeFileSync(
    path.join(outDir, panel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.tsx'),
    importDecls.join('\n') +
      `\nimport styles from '../../chess-analysis-lab.module.css';\nimport { ${sharedExports.join(', ')} } from './shared';\n\n` +
      code +
      '\n',
  );

  barrelContent += `export * from './${panel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}';\n`;
}

fs.writeFileSync(srcPath, barrelContent);
console.log('AST split successful!');
