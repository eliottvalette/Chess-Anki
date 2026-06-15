const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'components/chess-lab-panels.tsx');
const outDir = path.join(__dirname, 'components/lab/panels');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const content = fs.readFileSync(srcPath, 'utf8');

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

// We will split the file by "export function "
const parts = content.split('export function ');

const sharedContent = parts[0]; // Imports, types, helpers

fs.writeFileSync(path.join(outDir, 'shared.tsx'), sharedContent);

let barrel = `export * from './shared';\n`;

for (let i = 1; i < parts.length; i++) {
  const part = 'export function ' + parts[i];
  const nameMatch = part.match(/^export function ([a-zA-Z0-9]+)/);
  if (!nameMatch) continue;
  
  const name = nameMatch[1];
  
  if (panels.includes(name)) {
    const fileName = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.tsx';
    
    // Some panels depend on other panels (like ReviewPanel depends on GameReviewPanel).
    // We can't just put them in isolation without imports.
    // Let's just create a barrel file `chess-lab-panels.tsx` that exports all.
    // Wait! If they depend on each other, we must add imports!
    
    // Too complex for a regex split because of local dependencies.
    console.log(`Skipping regex split for ${name} due to dependency complexity.`);
  }
}

console.log('Skipped automated regex split. Keeping chess-lab-panels.tsx intact.');
