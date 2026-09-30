import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter';
import './styles.css';

// Block copying message content, drag-and-drop of files into/out of the window, and context menus.
document.addEventListener('copy', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('input, textarea')) e.preventDefault();
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => {
  if (!(e.target as HTMLElement | null)?.closest('input, textarea')) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
