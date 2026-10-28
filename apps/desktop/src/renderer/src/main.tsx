import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter';
import './styles.css';
import { initTheme } from './theme';

initTheme();

// Block copying message content, drag-and-drop of files into/out of the window, and context menus.
// Copying message text works only where the admin allows it (the chat is marked .allow-copy, see ChatView).
document.addEventListener('copy', (e) => {
  const target = e.target as HTMLElement | null;
  const node = document.getSelection()?.anchorNode;
  const where = node instanceof HTMLElement ? node : node?.parentElement;
  if (target?.closest('input, textarea') || where?.closest('.messages.allow-copy')) return;
  e.preventDefault();
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
