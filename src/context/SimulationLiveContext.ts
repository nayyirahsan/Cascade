import { createContext, useContext, type RefObject } from 'react';
import type { Particle, SimulationSnapshot } from '../hooks/useSimulation';

export interface SimulationLiveContextValue {
  snapshotRef: RefObject<SimulationSnapshot | null>;
  particlesRef: RefObject<Particle[]>;
}

export const SimulationLiveContext = createContext<SimulationLiveContextValue | null>(null);

export function useSimulationLive(): SimulationLiveContextValue {
  const ctx = useContext(SimulationLiveContext);
  if (!ctx) throw new Error('useSimulationLive must be used within SimulationLiveContext');
  return ctx;
}
