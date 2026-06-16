import { createContext, type ReactNode, useContext } from 'react';
import type { useLabOrchestrator } from './useLabOrchestrator';

export type LabContextValue = ReturnType<typeof useLabOrchestrator>;

const LabContext = createContext<LabContextValue | null>(null);

export function LabProvider({ children, value }: { children: ReactNode; value: LabContextValue }) {
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab() {
  const context = useContext(LabContext);
  if (!context) {
    throw new Error('useLab must be used within a LabProvider');
  }
  return context;
}
