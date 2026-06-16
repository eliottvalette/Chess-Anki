import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const targetFiles = [
  path.join(uiRoot, 'components/chess-lab-panels.tsx'),
  path.join(uiRoot, 'components/lab/board/BoardPlayerBar.tsx'),
  path.join(uiRoot, 'components/lab/board/LabBoardArea.tsx'),
  path.join(uiRoot, 'components/lab/sidebar/LabSidebar.tsx'),
];

function normalizeTypography(content) {
  let text = content;

  text = text.replace(/\s+uppercase/g, '');
  text = text.replace(/\s+normal-case/g, '');
  text = text.replace(/\s+tracking-\[[0-9.]+em\]/g, '');
  text = text.replace(/font-\[(550|560|650)\]/g, 'font-normal');
  text = text.replace(/font-medium/g, 'font-normal');

  return text;
}

function main() {
  let changedFileCount = 0;

  for (const filePath of targetFiles) {
    const original = fs.readFileSync(filePath, 'utf8');
    const updated = normalizeTypography(original);

    if (updated === original) {
      continue;
    }

    changedFileCount += 1;
    fs.writeFileSync(filePath, updated);
    console.log(`updated ${path.relative(uiRoot, filePath)}`);
  }

  console.log(`done: ${changedFileCount} file(s) updated`);
}

main();
