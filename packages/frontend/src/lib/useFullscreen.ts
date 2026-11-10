import { useEffect, useState } from 'react';

export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: fullscreen)');
    const update = () => setFullscreen(!!document.fullscreenElement || display.matches ||
      ('fullScreen' in window && window.fullScreen === true));
    update();
    display.addEventListener('change', update);
    document.addEventListener('fullscreenchange', update);
    window.addEventListener('resize', update);
    window.addEventListener('focus', update);
    window.addEventListener('pageshow', update);
    return () => {
      display.removeEventListener('change', update);
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('pageshow', update);
    };
  }, []);
  return fullscreen;
}
