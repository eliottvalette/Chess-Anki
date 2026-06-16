const { Project } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'components/chess-lab-panels.tsx');
const outDir = path.join(__dirname, 'components/lab/panels');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

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

const project = new Project();

// 1. Create shared.tsx
const sharedFile = project.createSourceFile(path.join(outDir, 'shared.tsx'), fs.readFileSync(srcPath, 'utf8'), {
  overwrite: true,
});
for (const p of panels) {
  const fn = sharedFile.getFunction(p);
  if (fn) fn.remove();
}
// We also need to export ALL the helpers so other files can use them if needed.
// Actually, if we just keep the helpers in each file, it's duplicate code but avoids import hell.
// Let's do it properly: `shared.tsx` will have the helpers EXPORTED.
const helperNames = [];
sharedFile.getFunctions().forEach((fn) => {
  if (!fn.hasExportKeyword() && fn.getName()) {
    fn.setIsExported(true);
    helperNames.push(fn.getName());
  }
});
sharedFile.saveSync();

// 2. Create the panel files
let barrel = `export * from './shared';\n`;

for (const panel of panels) {
  const fileName = panel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.tsx';
  const destPath = path.join(outDir, fileName);

  // Start with the raw original file
  const sf = project.createSourceFile(destPath, fs.readFileSync(srcPath, 'utf8'), { overwrite: true });

  // Remove all OTHER major panels
  for (const otherPanel of panels) {
    if (otherPanel !== panel) {
      const fn = sf.getFunction(otherPanel);
      if (fn) fn.remove();
    }
  }

  // Remove all the helper functions because they are now in shared.tsx!
  // Wait, if we remove them, we must import them from shared.tsx!
  // Let's just import them.
  for (const h of helperNames) {
    const fn = sf.getFunction(h);
    if (fn) fn.remove();
  }

  sf.addImportDeclaration({
    namedImports: helperNames,
    moduleSpecifier: './shared',
  });

  sf.saveSync();

  barrel += `export * from './${fileName.replace('.tsx', '')}';\n`;
}

// 3. Update chess-lab-panels.tsx to be a barrel file
fs.writeFileSync(srcPath, barrel);

console.log('Successfully split the panels with ts-morph!');
