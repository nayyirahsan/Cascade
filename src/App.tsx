import { useMemo } from 'react';
import Canvas from './components/Canvas';
import Controls from './components/Controls';
import FaultPanel from './components/FaultPanel';
import NodePanel from './components/NodePanel';
import Palette from './components/Palette';
import ScenarioMenu from './components/ScenarioMenu';
import { SimulationLiveProvider } from './context/SimulationLiveContext';
import { useSimulation } from './hooks/useSimulation';

function PanelShell({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-700/80 bg-slate-900/70 shadow-lg shadow-black/20 ${className}`}
    >
      <header className="border-b border-slate-700/60 px-3 py-2">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</h2>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export default function App() {
  const sim = useSimulation();

  const liveValue = useMemo(
    () => ({
      snapshotRef: sim.snapshotRef,
      particlesRef: sim.particlesRef,
    }),
    [sim.snapshotRef, sim.particlesRef],
  );

  return (
    <SimulationLiveProvider value={liveValue}>
      <div className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-[#0a0c10]">
        <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/80 px-5 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-5">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-cyan-400">Cascade</h1>
                <p className="text-[11px] text-slate-500">Distributed failure simulator</p>
              </div>
              <ScenarioMenu sim={sim} />
            </div>
            <Controls sim={sim} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-800/80 bg-slate-950/40 p-3">
            <PanelShell title="Palette">
              <Palette />
            </PanelShell>
            <PanelShell title="Faults" className="flex-1">
              <FaultPanel sim={sim} />
            </PanelShell>
          </aside>

          <main className="relative min-h-0 min-w-0 flex-1">
            <Canvas sim={sim} />
          </main>

          <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950/40 p-3">
            <PanelShell title="Node config">
              <NodePanel sim={sim} />
            </PanelShell>
          </aside>
        </div>
      </div>
    </SimulationLiveProvider>
  );
}
