import { useEffect } from 'react';
import { useLatticeStore, type ViewName } from './store.ts';
import { ImportView } from './views/ImportView.tsx';
import { EstateBrowserView } from './views/EstateBrowserView.tsx';
import { ImpactView } from './views/ImpactView.tsx';
import { DiscoveryView } from './views/DiscoveryView.tsx';
import { DataView } from './views/DataView.tsx';

interface NavItem {
  view: ViewName;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'import', label: 'Import' },
  { view: 'browser', label: 'Estate' },
  { view: 'impact', label: 'Impact' },
  { view: 'discovery', label: 'Discovery' },
  { view: 'data', label: 'Data' },
];

export function App() {
  const view = useLatticeStore((s) => s.view);
  const setView = useLatticeStore((s) => s.setView);
  const graph = useLatticeStore((s) => s.graph);
  const selection = useLatticeStore((s) => s.selection);
  const hydrateFromStore = useLatticeStore((s) => s.hydrateFromStore);

  useEffect(() => {
    // Runs once on mount to load any previously imported estate. The action
    // reference is stable (Zustand actions are not recreated per render).
    void hydrateFromStore();
  }, [hydrateFromStore]);

  function isDisabled(navView: ViewName): boolean {
    if (navView === 'impact') return selection === null;
    if (navView === 'browser' || navView === 'discovery') return graph === null;
    return false;
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="wordmark">
          CCS<span className="wordmark-stop">.</span>
        </span>
        <div className="app-title-group">
          <span className="app-title">Lattice</span>
          <span className="app-kicker">Blue Prism Release Analyser</span>
        </div>
        <div className="app-bar-spacer" />
      </header>
      <nav className="app-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`nav-tab${view === item.view ? ' active' : ''}`}
            disabled={isDisabled(item.view)}
            onClick={() => setView(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {view === 'import' && <ImportView />}
        {view === 'browser' && <EstateBrowserView />}
        {view === 'impact' && <ImpactView />}
        {view === 'discovery' && <DiscoveryView />}
        {view === 'data' && <DataView />}
      </main>
    </div>
  );
}
