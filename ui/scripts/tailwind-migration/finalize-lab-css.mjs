#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(scriptDirectory, '../..');

const targets = [
  path.join(uiRoot, 'components/chess-lab-panels.tsx'),
  path.join(uiRoot, 'components/lab/sidebar/LabSidebar.tsx'),
  path.join(uiRoot, 'components/lab/board/LabBoardArea.tsx'),
];

const corruptedCardEmpty =
  /\$\{'min-h-0 relative border-\[1px\] border-solid border-\[var\(--border-soft\)\] rounded-\[12px\] bg-\[var\(--surface\)\] p-\[15px\] shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.05\)\] backdrop-blur-16px\) saturate\(1\.16'\} \$\{'flex flex-col gap-\[13px\] flex-\[0_0_auto\] gap-\[18px\] overflow-visible gap-\[16px\]'\}/g;

const corruptedCardSimple =
  /\$\{'min-h-0 relative border-\[1px\] border-solid border-\[var\(--border-soft\)\] rounded-\[12px\] bg-\[var\(--surface\)\] p-\[15px\] shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.05\)\] backdrop-blur-16px\) saturate\(1\.16'\} \$\{'flex flex-col gap-\[13px\] flex-\[0_0_auto\]'\}/g;

const corruptedCardCreateDeck =
  /\$\{'min-h-0 relative border-\[1px\] border-solid border-\[var\(--border-soft\)\] rounded-\[12px\] bg-\[var\(--surface\)\] p-\[15px\] shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.05\)\] backdrop-blur-16px\) saturate\(1\.16'\} \$\{'flex flex-col gap-\[13px\] flex-\[0_0_auto\] gap-\[18px\] overflow-visible gap-\[16px\]'\} \$\{focusCreateDeck \? 'border-\[rgba\(198,215,255,0\.58\)\] shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.05\),inset_0_0_0_1px_rgba\(198,215,255,0\.14\)\]' : ''\}/g;

for (const targetPath of targets) {
  let source = fs.readFileSync(targetPath, 'utf8');

  source = source.replace(
    /import styles from ['"]\.\/chess-analysis-lab\.module\.css['"];\n/g,
    "import { lab } from '@/components/lab/lab-ui-classes';\n",
  );
  source = source.replace(
    /import styles from ['"]\.\.\/\.\.\/chess-analysis-lab\.module\.css['"];\n/g,
    "import { lab } from '@/components/lab/lab-ui-classes';\n",
  );
  source = source.replace(/styles\./g, 'lab.');

  if (targetPath.endsWith('chess-lab-panels.tsx')) {
    source = source.replace(corruptedCardEmpty, '${lab.card} ${lab.emptyStateCard}');
    source = source.replace(corruptedCardSimple, '${lab.card}');
    source = source.replace(
      corruptedCardCreateDeck,
      "${lab.card} ${lab.emptyStateCard} ${focusCreateDeck ? 'border-[rgba(198,215,255,0.58)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(198,215,255,0.14)]' : ''}",
    );
  }

  fs.writeFileSync(targetPath, source, 'utf8');
  console.log(`updated ${path.relative(uiRoot, targetPath)}`);
}

const cssModulePath = path.join(uiRoot, 'components/chess-analysis-lab.module.css');
if (fs.existsSync(cssModulePath)) {
  fs.unlinkSync(cssModulePath);
  console.log('deleted chess-analysis-lab.module.css');
}
