import { useEffect, useState } from 'react';
import { Layout, ROUTES, type Route } from './components/Layout';
import { BotsProvider, useBots } from './hooks/BotsContext';
import { Home } from './pages/Home';
import { AnalystPage } from './pages/AnalystPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { Backtest } from './pages/Backtest';
import { SettingsPage } from './pages/SettingsPage';

const fromHash = (): Route => {
  const h = location.hash.replace('#', '') as Route;
  return ROUTES.some((r) => r.id === h) ? h : 'inicio';
};

function Shell() {
  const [route, setRoute] = useState<Route>(fromHash);
  const { status, sim } = useBots();

  useEffect(() => {
    const onHash = () => setRoute(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (r: Route) => {
    if (location.hash !== `#${r}`) location.hash = r;
    setRoute(r);
    window.scrollTo({ top: 0 });
  };

  return (
    <Layout route={route} onNavigate={go} analystStatus={status} simActive={sim.mode === 'ATIVO'}>
      {route === 'inicio' && <Home go={go} />}
      {route === 'analista' && <AnalystPage />}
      {route === 'simulador' && <SimulatorPage />}
      {route === 'backtest' && <Backtest />}
      {route === 'config' && <SettingsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <BotsProvider>
      <Shell />
    </BotsProvider>
  );
}
