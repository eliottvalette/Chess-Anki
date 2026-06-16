import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const focusDisabled =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none';

const action = `box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal uppercase tracking-[0.04em] text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] ${focusDisabled}`;

const primary = `box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal uppercase tracking-[0.04em] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)] ${focusDisabled}`;

const primarySaved = `box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] px-3.5 text-xs font-normal uppercase tracking-[0.04em] text-[#d8f5cc] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(138,227,193,0.52)] hover:bg-[rgba(56,148,115,0.22)] hover:text-[#d8f5cc] ${focusDisabled}`;

const danger = `box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] px-3.5 text-xs font-normal uppercase tracking-[0.04em] text-[#ffc8c6] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df] ${focusDisabled}`;

const confirm = `box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] px-3.5 text-xs font-normal uppercase tracking-[0.04em] text-[#d8f5cc] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)] ${focusDisabled}`;

const confirmBest = `${confirm} disabled:opacity-[0.42]`;

const fullWidth = 'w-full min-w-0 self-stretch';
const colSpanFull = 'col-span-full w-full';

const modeTab = `box-border min-h-[38px] min-w-0 truncate rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] px-2 text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--text-muted)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] ${focusDisabled}`;

const modeTabActive = `box-border min-h-[38px] min-w-0 truncate rounded-[10px] border border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] px-2 text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] ${focusDisabled}`;

const oldBlob =
  'box-border rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none min-h-[42px] px-3.5 text-xs font-normal uppercase tracking-[0.04em]';

const primaryAddon =
  'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)]';

const dangerAddon =
  'border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] text-[#ffc8c6] hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df]';

const confirmAddon =
  'border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)]';

function fixPanels(source) {
  let next = source;

  next = next.replaceAll(
    `\`${oldBlob} flex items-center justify-center ${primaryAddon} w-full min-w-0 self-stretch \${reviewDeckSaveStatus === 'Saved' ? 'border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] text-[#d8f5cc]' : ''}\``,
    `\`\${reviewDeckSaveStatus === 'Saved' ? '${primarySaved} ${fullWidth}' : '${primary} ${fullWidth}'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} flex items-center justify-center ${primaryAddon} w-full min-w-0 self-stretch\``,
    `\`${primary} ${fullWidth}\``,
  );

  next = next.replaceAll(`\`${oldBlob} flex items-center justify-center ${primaryAddon}\``, `\`${primary}\``);

  next = next.replaceAll(`\`${oldBlob} w-full min-w-0 self-stretch ${dangerAddon}\``, `\`${danger} ${fullWidth}\``);

  next = next.replaceAll(`\`${oldBlob} ${dangerAddon}\``, `\`${danger}\``);

  next = next.replaceAll(
    `\`${oldBlob} border border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)] disabled:opacity-[0.42]\``,
    `\`${confirmBest}\``,
  );

  next = next.replaceAll(`\`${oldBlob} w-full min-w-0 self-stretch\``, `\`${action} ${fullWidth}\``);

  next = next.replaceAll(
    `\`${oldBlob} col-span-full \${chesscomUsername.trim() && !recentGamesLoading ? '${confirmAddon}' : ''}\``,
    `\`\${chesscomUsername.trim() && !recentGamesLoading ? '${confirm} ${colSpanFull}' : '${action} ${colSpanFull}'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} col-span-full \${newDeckTitle.trim() && !deckActionLoading ? '${confirmAddon}' : ''}\``,
    `\`\${newDeckTitle.trim() && !deckActionLoading ? '${confirm} ${colSpanFull}' : '${action} ${colSpanFull}'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} w-full min-w-0 self-stretch \${trainSide === 'white' ? '${primaryAddon}' : ''}\``,
    `\`\${trainSide === 'white' ? '${primary} ${fullWidth}' : '${action} ${fullWidth}'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} w-full min-w-0 self-stretch \${trainSide === 'black' ? '${primaryAddon}' : ''}\``,
    `\`\${trainSide === 'black' ? '${primary} ${fullWidth}' : '${action} ${fullWidth}'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} \${recentGameTimeClass === timeClass ? '${primaryAddon}' : 'w-full'}\``,
    `\`\${recentGameTimeClass === timeClass ? '${primary} w-full' : '${action} w-full'}\``,
  );

  next = next.replaceAll(
    `\`${oldBlob} flex items-center justify-center ${primaryAddon} col-span-full\``,
    `\`${primary} ${colSpanFull}\``,
  );

  next = next.replaceAll(
    `${oldBlob} flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)] w-full min-w-0 self-stretch`,
    `${primary} ${fullWidth}`,
  );

  next = next.replaceAll(
    `${oldBlob} flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)] col-span-full`,
    `${primary} ${colSpanFull}`,
  );

  next = next.replaceAll(
    `${oldBlob} flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)]`,
    primary,
  );

  next = next.replaceAll(`${oldBlob} w-full`, `${action} w-full`);

  next = next.replaceAll(`"${oldBlob}"`, `"${action}"`);

  next = next.replaceAll(
    `\`${oldBlob} flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)] w-full min-w-0 self-stretch \${reviewDeckSaveStatus === 'Saved' ? 'border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] text-[#d8f5cc]' : ''}\``,
    `\`\${reviewDeckSaveStatus === 'Saved' ? '${primarySaved} ${fullWidth}' : '${primary} ${fullWidth}'}\``,
  );

  return next;
}

function fixSidebar(source) {
  const oldModeTab =
    'box-border rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none min-h-[38px] min-w-0 truncate px-2 text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--text-muted)]';

  const activeAddon =
    'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)]';

  return source.replaceAll(
    `\`${oldModeTab} \${lab.labState.mode === tabMode ? '${activeAddon}' : ''}\``,
    `\`\${lab.labState.mode === tabMode ? '${modeTabActive}' : '${modeTab}'}\``,
  );
}

const panelsPath = path.join(uiRoot, 'components/chess-lab-panels.tsx');
const sidebarPath = path.join(uiRoot, 'components/lab/sidebar/LabSidebar.tsx');

const panelsSource = fixPanels(fs.readFileSync(panelsPath, 'utf8'));
fs.writeFileSync(panelsPath, panelsSource);
console.log('fixed chess-lab-panels.tsx buttons');

const sidebarSource = fixSidebar(fs.readFileSync(sidebarPath, 'utf8'));
fs.writeFileSync(sidebarPath, sidebarSource);
console.log('fixed LabSidebar.tsx mode tabs');
