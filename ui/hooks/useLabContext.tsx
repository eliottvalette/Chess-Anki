import { createContext, useContext, type ReactNode } from 'react';
import { useLabState, type LabState } from './useLabState';

export const LabContext = createContext<LabState | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const state = useLabState();

  return <LabContext.Provider value={state}>{children}</LabContext.Provider>;
}

export function useLabContext() {
  const context = useContext(LabContext);
  if (!context) {
    throw new Error('useLabContext must be used within a LabProvider');
  }
  return context;
}
