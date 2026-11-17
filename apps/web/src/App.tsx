import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { BoardPage } from './board/BoardPage.tsx';
import { SquadPage } from './board/SquadPage.tsx';
import { TvPage } from './board/TvPage.tsx';
import { Band } from './components/Brand.tsx';
import { isDemo } from './lib/env.ts';
import { ScorerApp } from './scorer/ScorerApp.tsx';

function Home() {
  return (
    <>
      <Band label="Scoring & live standings" />
      <main className="page stack">
        {isDemo && <div className="note">Demo mode: no backend connected. Everything runs in this browser with made-up data.</div>}
        <Link className="btn btn-clay btn-block" to="/board">Live leaderboard</Link>
        <Link className="btn btn-ink btn-block" to="/score">Volunteer scoring</Link>
        <Link className="btn btn-line btn-block" to="/tv">Clubhouse TV view</Link>
      </main>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/score" element={<ScorerApp />} />
      <Route path="/board" element={<BoardPage />} />
      <Route path="/me/:token" element={<SquadPage />} />
      <Route path="/tv" element={<TvPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
