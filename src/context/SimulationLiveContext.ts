import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import type { Particle, SimulationSnapshot } from '../hooks/useSimulation';

export interface SimulationLiveContextValue {
  snapshotRef: RefObject<SimulationSnapshot | null>;
  particlesRef: RefObject<Particle[]>;
}

const SimulationLiveContext = createContext<SimulationLiveContextValue | null>(null);

export function SimulationLiveProvider({
  value,
  children,
}: {
  value: SimulationLiveContextValue;
  children: ReactNode;
}) {
  return <SimulationLiveContext.Provider value={value}>{children}</SimulationLiveContext.Provider>;
}

export function useSimulationLive(): SimulationLiveContextValue {
  const ctx = useContext(SimulationLiveContext);
  if (!ctx) throw new Error('useSimulationLive must be used within SimulationLiveProvider');
  return ctx;
}
