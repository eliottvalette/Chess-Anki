import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelsPath = resolve('components/chess-lab-panels.tsx');
let content = readFileSync(panelsPath, 'utf8');

const YOLO_BASE =
  "'border-[1px] border-solid border-[--border)] bg-[rgba(9,14,23,0.38)] text-[--text)] transition-border-color duration-[160ms] transition-ease,background-color delay-[160ms] transition-ease,color delay-[160ms] transition-ease,transform delay-[160ms] ease-[ease] border-[rgba(214,226,244,0.28)] bg-[rgba(4,8,15,0.58)] box-border min-h-[42px] px-[14px] py-0 rounded-[10px] text-[12px] font-[400] tracking-[0.04em] uppercase text-[--text-disabled)] bg-[rgba(9,14,23,0.26)] border-[rgba(214,226,244,0.1)] cursor-not-allowed op-100 outline-2px solid var(--accent-strong) outline-offset-2px min-h-[36px] min-h-[38px] px-[8px] py-0 text-[11px] min-h-[34px] text-[10px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'";

const YOLO_PRIMARY =
  "'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'";

const YOLO_FULLWIDTH = "'w-full min-w-0 self-stretch min-h-[46px] min-h-[34px] px-[8px] py-0 text-[10px]'";

const YOLO_DANGER =
  "'border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] text-[#ffc8c6] border-[rgba(255,120,120,0.52)] bg-[rgba(120,28,28,0.28)] text-[#ffe0df]'";

const YOLO_CONFIRM =
  "'border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] border-[rgba(184,247,161,0.72)] bg-[rgba(184,247,161,0.18)]'";

const YOLO_OPENING_TREE =
  "'w-full min-w-0 flex flex-col gap-[8px] border-[1px] border-solid border-[rgba(214,226,244,0.18)] rounded-[10px] bg-[rgba(9,14,23,0.4)] text-[--text-muted)] px-[12px] py-[11px] text-left cursor-pointer transition-border-color duration-[160ms] transition-ease,background-color delay-[160ms] ease-[ease] border-[rgba(214,226,244,0.28)]'";

const YOLO_ACTIVE_SIDE =
  "'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)]'";

const replacements = [
  [`\${${YOLO_BASE}} \${${YOLO_PRIMARY}} \${${YOLO_FULLWIDTH}}`, '${labFullWidthSideTab} ${labPrimaryButton}'],
  [`\${${YOLO_BASE}} \${${YOLO_FULLWIDTH}} \${${YOLO_DANGER}}`, '${labFullWidthSideTab} ${labDangerButton}'],
  [
    `\${${YOLO_BASE}} \${${YOLO_FULLWIDTH}} \${trainSide === 'white' ? 'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : ''}`,
    "${labFullWidthSideTab} ${trainSide === 'white' ? labPrimaryButton : ''}",
  ],
  [
    `\${${YOLO_BASE}} \${${YOLO_FULLWIDTH}} \${trainSide === 'black' ? 'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : ''}`,
    "${labFullWidthSideTab} ${trainSide === 'black' ? labPrimaryButton : ''}",
  ],
  [`\${${YOLO_BASE}} \${${YOLO_PRIMARY}} \${'col-span-full'}`, '${labActionButton} ${labPrimaryButton} col-span-full'],
  [
    `\${${YOLO_BASE}} \${'col-span-full'} \${chesscomUsername.trim() && !recentGamesLoading ? ${YOLO_CONFIRM} : ''}`,
    "${labActionButton} col-span-full ${chesscomUsername.trim() && !recentGamesLoading ? labConfirmButton : ''}",
  ],
  [
    `\${${YOLO_BASE}} \${recentGameTimeClass === timeClass ? ${YOLO_PRIMARY} : 'w-full'}`,
    "${labSideTabButton} ${recentGameTimeClass === timeClass ? labPrimaryButton : 'w-full'}",
  ],
  [
    `\${${YOLO_OPENING_TREE}} \${tree.id === activeTreeId ? ${YOLO_ACTIVE_SIDE} : ''}`,
    "${labOpeningTreeButton} ${tree.id === activeTreeId ? labActiveSideTab : ''}",
  ],
];

for (const [from, to] of replacements) {
  const count = content.split(from).length - 1;
  if (count > 0) {
    content = content.split(from).join(to);
    console.log(`Replaced ${count}x: ${to.slice(0, 60)}...`);
  }
}

const remainingYolo = (
  content.match(/border-\[1px\] border-solid border-\[var\(--border\)\] bg-\[rgba\(9,14,23/g) ?? []
).length;
console.log(`Remaining YOLO button bases: ${remainingYolo}`);

if (!content.includes("from '@/components/lab/lab-ui-classes'")) {
  content = content.replace(
    "'use client';",
    "'use client';\n\nimport {\n  labActionButton,\n  labActiveSideTab,\n  labConfirmButton,\n  labDangerButton,\n  labFullWidthSideTab,\n  labOpeningTreeButton,\n  labPrimaryButton,\n  labSideTabButton,\n} from '@/components/lab/lab-ui-classes';",
  );
}

writeFileSync(panelsPath, content);
console.log('Done.');
