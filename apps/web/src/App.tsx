import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Logo } from './components/Icons';
import { ToastProvider } from './components/Toasts';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { RulesPage } from './pages/RulesPage';

function NotFoundPage() {
  return (
    <main className="page narrow" id="main">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <a className="visually-hidden" href="#main">
          Skip to content
        </a>
        <header className="app-header">
          <Link to="/" className="brand" aria-label="Cabo Online home">
            <Logo />
            Cabo Online
          </Link>
          <nav className="header-links" aria-label="Main">
            <Link to="/rules">Rules</Link>
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/r/:code" element={<RoomPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <footer className="footer">Unofficial fan-made implementation of the Cabo card game. Not affiliated with the publisher.</footer>
      </ToastProvider>
    </BrowserRouter>
  );
}
