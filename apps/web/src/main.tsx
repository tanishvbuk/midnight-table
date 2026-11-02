import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Castle } from './pages/Castle';
import { Home } from './pages/Home';
import { Join } from './pages/Join';
import { Play } from './pages/Play';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/cinzel-decorative/900.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import './styles.css';

function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

function App() {
  const path = usePath();
  const m = /^\/(join|play|castle)\/([A-Za-z]{4})$/.exec(path);
  const code = m?.[2]?.toUpperCase() ?? '';
  if (m?.[1] === 'join') return <Join code={code} />;
  if (m?.[1] === 'play') return <Play code={code} />;
  if (m?.[1] === 'castle') return <Castle code={code} />;
  return <Home />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
