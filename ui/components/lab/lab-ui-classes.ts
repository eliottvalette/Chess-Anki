const labControlBase =
  'box-border rounded-[10px] border border-[--border)] bg-[rgba(9,14,23,0.38)] text-[--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[--text-disabled)] disabled:shadow-none';

const labActionBase = `${labControlBase} min-h-[42px] px-3.5 text-xs font-normal uppercase tracking-[0.04em]`;

const labScrollHide = '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export const lab = {
  panel:
    'min-w-0 min-h-0 overflow-hidden rounded-2xl border border-[--border)] bg-[--panel-bg)] shadow-[--glass-shadow)] backdrop-blur-[22px] backdrop-saturate-[1.2]',
  contextPanel: 'flex flex-col gap-3.5 p-[18px]',
  panelScroll: `min-h-0 flex flex-1 flex-col gap-[--panel-scroll-gap)] overflow-y-auto overflow-x-hidden pr-[3px] ${labScrollHide}`,
  reviewPanelScroll: 'overflow-hidden pr-0',
  modeTabs: 'grid grid-cols-3 gap-2',
  modeTab: `${labControlBase} min-h-[38px] min-w-0 truncate px-2 text-[11px] font-normal uppercase tracking-[0.04em] text-[--text-muted)]`,
  activeModeTab:
    'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)]',

  card: 'relative min-h-0 rounded-xl border border-[--border-soft)] bg-[--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[16px] backdrop-saturate-[1.16]',
  emptyStateCard: 'flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible',
  openingListCard: 'flex min-h-0 max-h-[calc(100svh-250px)] flex-[0_1_auto] flex-col gap-2.5',
  openingTreeCard: 'flex min-h-0 max-h-[min(690px,calc(100svh-174px))] flex-[0_0_auto] flex-col gap-3 overflow-hidden',

  panelHeader: 'flex min-w-0 items-center justify-between gap-3.5',
  sectionTitle:
    'm-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] font-[560] leading-[1.15] tracking-normal text-[--text)]',
  statusText: 'text-sm leading-[1.45] text-[--text-muted)]',
  copy: 'm-0 text-sm leading-[1.45] text-[--text-muted)]',
  error: 'm-0 text-sm leading-[1.45] text-[#ffb4b2]',

  action: labActionBase,
  primary:
    'flex items-center justify-center border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-[--text)]',
  secondary: 'w-full',
  fullWidthAction: 'w-full min-w-0 self-stretch',
  backAction:
    'border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] text-[#ffc8c6] hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df]',
  deleteAction:
    'border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] text-[#ffc8c6] hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df]',
  confirmAction:
    'border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)]',
  actionBest:
    'border border-[rgba(184,247,161,0.52)] bg-[rgba(184,247,161,0.12)] text-[#d8f5cc] hover:border-[rgba(184,247,161,0.72)] hover:bg-[rgba(184,247,161,0.18)] disabled:opacity-[0.42]',
  saveAdded: 'border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] text-[#d8f5cc]',
  inlineFormWide: 'col-span-full',
  profileFormWide: 'col-span-full',

  iconButton:
    'inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-[--border)] bg-[rgba(9,14,23,0.38)] p-0 font-[550] text-[--text)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--accent-strong)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[--text-disabled)] disabled:shadow-none',

  linesLibrary: `flex max-h-[300px] min-h-0 flex-col gap-3.5 overflow-y-auto overflow-x-hidden pr-[3px] ${labScrollHide}`,
  linesFilters: 'flex flex-row gap-3 rounded-[10px] border border-[--border-soft)] bg-[--surface-strong)] px-3 py-2.5',
  linesFilterItem: 'flex min-w-0 flex-1 flex-col gap-1',
  linesFilterLabel: 'text-[10px] font-medium tracking-[0.04em] text-[--text-soft)]',
  linesFilterInput:
    'w-full rounded-md border border-[--border-soft)] bg-transparent px-2 py-1 text-[13px] text-[--text)] outline-none transition-[border-color] duration-150 focus:border-[--accent)]',
  linesFilterCount: 'text-[11px] text-[--text-soft)]',
  linesLibraryGroup: 'flex min-w-0 flex-col gap-2',
  linesLibraryTitle: 'm-0 text-[11px] font-medium uppercase tracking-[0.08em] text-[--text-soft)]',
  openingTreeList: 'flex min-h-0 flex-col gap-2',
  openingTreeItem:
    'flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] border border-[rgba(214,226,244,0.18)] bg-[rgba(9,14,23,0.4)] px-3 py-[11px] text-left text-[--text-muted)] transition-[border-color,background-color] duration-150 hover:border-[rgba(214,226,244,0.28)]',
  openingTreeItemActive:
    'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)]',
  openingTreeItemHead:
    'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 [&_strong]:min-w-0 [&_strong]:text-[13px] [&_strong]:leading-tight [&_strong]:text-[--text)] [overflow-wrap:anywhere]',
  openingTreeMastery: 'flex-none text-[11px] font-medium uppercase leading-none text-[--text-soft)] [&+strong]:min-w-0',
  openingTreeItemRoot: 'block font-mono text-[11px] leading-[1.35] text-[--text-muted)] [overflow-wrap:anywhere]',
  openingTreeItemStats:
    'flex flex-wrap gap-2.5 [&_span]:text-[10px] font-medium uppercase leading-none tracking-[0.03em] text-[--text-soft)]',

  trainBackRow: 'flex w-full items-stretch gap-2',
  trainingCardHead: 'flex min-w-0 items-center justify-between gap-2.5',
  trainingCardTitleBlock: 'flex min-w-0 flex-col gap-1',
  trainingCardTitle: 'text-base leading-[1.2] tracking-normal text-[--text)] [overflow-wrap:anywhere]',
  trainingCardMeta: 'flex items-center justify-between gap-2.5 text-xs text-[--text-soft)]',

  feedbackGood: 'border border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)]',
  feedbackPending: 'border border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]',
  feedbackBad: 'border border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]',

  openingTreeCanvas: 'opening-tree-canvas',

  openingTreeNode: 'opening-tree-node',
  openingTreeNodeActive: 'opening-tree-node-active',
  openingTreeNodeTrain: 'opening-tree-node-train',
  openingTreeNodeOpponent: 'opening-tree-node-opponent',
  openingTreeNodeWeak: 'opening-tree-node-weak',
  openingTreeNodeButton:
    'flex min-h-[58px] w-full cursor-pointer flex-col justify-center gap-1 border-0 bg-transparent px-2.5 py-2 text-left text-inherit [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-[13px] [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:text-[10px] font-[550] uppercase text-[--text-soft)]',
  openingTreeEdgeBest: 'opening-tree-edge-best',

  moveList: `flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overflow-x-hidden rounded-xl border border-[rgba(214,226,244,0.12)] bg-[rgba(6,10,17,0.38)] pr-1 ${labScrollHide}`,
  openingList: `flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-[3px] ${labScrollHide}`,
  openingButton:
    'grid min-h-[44px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border border-[--border)] bg-[rgba(9,14,23,0.38)] px-3 text-[13px] text-[--text-muted)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[--text-disabled)]',
  recentGameButton:
    'min-h-[62px] grid-cols-[minmax(0,112px)_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left',
  recentGameWin:
    'border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.12)] hover:border-[rgba(138,227,193,0.56)] hover:bg-[rgba(56,148,115,0.24)]',
  recentGameLoss:
    'border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.12)] hover:border-[rgba(255,141,145,0.56)] hover:bg-[rgba(180,58,66,0.24)]',
  recentGameDraw:
    'border-[rgba(152,184,255,0.28)] hover:border-[rgba(152,184,255,0.44)] hover:bg-[rgba(46,58,82,0.34)]',
  recentGameDate: 'col-start-1 row-span-2 self-center text-xs text-[--text-soft)]',
  recentGamePlayers:
    'col-start-2 row-start-1 justify-self-center text-[13px] normal-case tracking-normal text-[--text)]',
  recentGameMoves: 'col-start-3 row-span-2 self-center justify-self-end text-xs text-[--text-soft)]',
  recentGameMeta: 'col-start-2 row-start-2 text-xs text-[--text-muted)]',

  reviewMoveTableScroller: `min-h-0 overflow-y-auto overflow-x-hidden px-0.5 ${labScrollHide}`,
  reviewMoveTable: 'w-full table-fixed border-collapse',

  deckLibraryItemWrap: 'relative min-w-0',
  activeDeckLibraryItemWrap: '',
  deckLibraryItem:
    'flex w-full min-w-0 flex-col gap-[9px] rounded-[10px] border border-[--border)] bg-[rgba(9,14,23,0.38)] py-[11px] pl-3 pr-11 text-left text-[--text-muted)] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-[--text)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-[--text-disabled)]',
  activeDeckLibraryItem:
    'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-[--text)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.72)] hover:bg-[rgba(52,68,98,0.66)]',
  deckLibraryHead:
    'flex min-w-0 items-center justify-between gap-2.5 [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-sm [&_strong]:leading-[1.15] [&_strong]:text-[--text)] [&_span]:text-[11px] uppercase text-[--text-soft)]',
  deckLibraryMeta:
    'flex min-w-0 items-center justify-between gap-2.5 [&_span]:whitespace-nowrap [&_span]:text-[11px] uppercase text-[--text-soft)]',
  deckLibraryMenuAnchor: 'absolute top-2 right-2 z-[2]',
  deckLibraryMenuButton:
    'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[--border)] bg-[rgba(9,14,23,0.72)] text-[--text-muted)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.82)] hover:text-[--text)] disabled:cursor-not-allowed disabled:opacity-45',
  deckLibraryMenu:
    'absolute top-[calc(100%+4px)] right-0 z-[5] flex min-w-[148px] flex-col gap-1 rounded-[10px] border border-[rgba(214,226,244,0.18)] bg-[rgba(8,12,19,0.96)] p-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.34)]',
  deckLibraryMenuOption:
    'min-h-[34px] rounded-lg border border-transparent bg-transparent px-2.5 text-left text-xs tracking-[0.03em] text-[--text)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.16)] hover:bg-[rgba(4,8,15,0.72)]',
  deckLibraryMenuOptionDanger:
    'text-[#ffc8c6] hover:border-[rgba(255,120,120,0.28)] hover:bg-[rgba(120,28,28,0.22)] hover:text-[#ffe0df]',

  pgnInput: `box-border h-full min-h-0 w-full resize-none overflow-auto rounded-[10px] border border-[--border)] bg-[rgba(7,12,20,0.72)] p-3 font-mono text-xs leading-[1.55] text-[--text)] outline-none focus:border-[--accent)] focus:shadow-[0_0_0_3px_rgba(152,184,255,0.16)] placeholder:text-[--text-disabled)] ${labScrollHide}`,
  engineLines: `flex min-h-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden ${labScrollHide}`,
  masteryDistributionCard: 'flex flex-col gap-2.5 rounded-[10px] bg-[rgba(9,14,23,0.34)] p-3',
  trainingDeckCard: 'flex max-h-none flex-col gap-2.5 overflow-visible rounded-[10px] p-3',
  lineMetricCard: 'flex flex-col gap-2.5 rounded-[10px] p-3',
} as const;
