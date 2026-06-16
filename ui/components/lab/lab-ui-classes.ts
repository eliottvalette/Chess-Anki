export const labPanelScroll =
  'min-h-0 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export const labControlBase =
  'box-border rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none';

export const labActionButton = `${labControlBase} min-h-[42px] px-3.5 text-xs font-normal normal-case tracking-normal`;

export const labFullWidthAction = `${labActionButton} w-full min-w-0 self-stretch`;

export const labCompactAction = `${labActionButton} min-h-[38px] px-2 text-[11px]`;

export const labSideTabButton = `${labControlBase} min-h-[38px] min-w-0 truncate px-2 text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--text-muted)]`;

export const labFullWidthSideTab = `${labSideTabButton} w-full min-w-0 self-stretch`;

export const labPrimaryButton =
  'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[var(--text)]';

export const labActiveSideTab =
  'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)]';

export const labDangerButton =
  'border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] text-[#ffc8c6] hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df]';

export const labConfirmButton =
  'border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)]';

export const labModeTabButton =
  'min-h-[38px] min-w-0 truncate rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] text-[11px] font-normal uppercase tracking-[0.04em] text-[var(--text-muted)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]';

export const labActiveModeTab =
  'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)]';

export const labIconButton =
  'inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] p-0 font-medium text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none';

export const labOpeningTreeButton =
  'flex w-full min-w-0 flex-col gap-2 rounded-[10px] border border-[rgba(214,226,244,0.18)] bg-[rgba(9,14,23,0.4)] px-3 py-[11px] text-left text-[var(--text-muted)] transition-[border-color,background-color] duration-150 hover:border-[rgba(214,226,244,0.28)]';

export const labDeckLibraryButton =
  'flex w-full min-w-0 flex-col gap-[9px] rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] pt-[11px] pb-[11px] pl-3 pr-11 text-left text-[var(--text-muted)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none';

export const labDeckLibraryButtonSelected =
  'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.72)] hover:bg-[rgba(52,68,98,0.66)]';

export const labDeckMenuButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[rgba(9,14,23,0.72)] text-[var(--text-muted)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.82)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45';

export const labMenuItem =
  'min-h-[34px] rounded-lg border border-transparent bg-transparent px-2.5 py-0 text-left text-xs tracking-[0.03em] text-[var(--text)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.16)] hover:bg-[rgba(4,8,15,0.72)]';

export const labMenuItemDanger =
  'text-[#ffc8c6] hover:border-[rgba(255,120,120,0.28)] hover:bg-[rgba(120,28,28,0.22)] hover:text-[#ffe0df]';

export const labDialogCloseButton =
  'inline-flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] p-0 font-medium text-[var(--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[var(--text-disabled)] disabled:shadow-none';

export const labRecentGameButton =
  'grid min-h-[62px] w-full min-w-0 grid-cols-[minmax(0,112px)_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 gap-y-1 rounded-[10px] border border-[var(--border)] bg-[rgba(9,14,23,0.38)] px-3 py-2.5 text-left text-[var(--text-muted)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)]';

export const labRecentGameWin =
  'border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.12)] hover:border-[rgba(138,227,193,0.56)] hover:bg-[rgba(56,148,115,0.24)]';

export const labRecentGameLoss =
  'border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.12)] hover:border-[rgba(255,141,145,0.56)] hover:bg-[rgba(180,58,66,0.24)]';

export const labRecentGameDraw =
  'border-[rgba(152,184,255,0.28)] hover:border-[rgba(152,184,255,0.44)] hover:bg-[rgba(46,58,82,0.34)]';
