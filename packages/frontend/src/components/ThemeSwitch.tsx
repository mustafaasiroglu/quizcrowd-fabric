import { useState } from 'react';
import { Icon } from './Icon';

export function ThemeSwitch() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [storageError, setStorageError] = useState(document.documentElement.dataset.themeStorage === 'unavailable');
  function choose(next: 'dark' | 'light') {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem('quizcrowd-theme', next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  return <div className="theme-control">
    <div className="theme-switch" role="group" aria-label="Color theme">
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => choose('dark')}><Icon name="moon" />Dark</button>
      <button type="button" aria-pressed={theme === 'light'} onClick={() => choose('light')}><Icon name="sun" />Light</button>
    </div>
    {storageError && <p className="theme-notice" role="status">Browser storage is unavailable. Your theme will reset on reload.</p>}
  </div>;
}
