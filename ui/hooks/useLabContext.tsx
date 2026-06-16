import { createContext, type ReactNode, useContext } from 'react';
import { type LabState, useLabState } from './useLabState';

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
