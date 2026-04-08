import { scenarios } from '../scenarios';
import type { useSimulation } from '../hooks/useSimulation';

type SimApi = ReturnType<typeof useSimulation>;

interface ScenarioMenuProps {
  sim: SimApi;
}

export default function ScenarioMenu({ sim }: ScenarioMenuProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Scenario</span>
      <select
        value={sim.scenario.name}
        onChange={(e) => sim.loadScenario(e.target.value)}
        className="min-w-[12rem] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
      >
        {scenarios.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
