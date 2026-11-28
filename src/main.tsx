import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

document.documentElement.classList.add('dark');
try {
  localStorage.removeItem('dankiv_theme_dark');
} catch {
  // Ignore storage errors
}

registerSW({immediate: true});

createRoot(document.getElementById('root')!).render(<App />);
