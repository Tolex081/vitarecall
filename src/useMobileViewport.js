import { useEffect, useState } from 'react';

// Fit the visible viewport without stealing focus or restricting zoom.
export function useMobileViewport(active) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (!active) { setKeyboardOpen(false); return; }
    const viewport = window.visualViewport;
    const media = window.matchMedia('(max-width: 730px)');
    let frame;
    let unfocusedHeight = window.innerHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!media.matches) {
          document.documentElement.style.removeProperty('--mobile-viewport-height');
          setKeyboardOpen(false);
          return;
        }
        const height = viewport?.height || window.innerHeight;
        const nextHeight = `${Math.round(height)}px`;
        if (document.documentElement.style.getPropertyValue('--mobile-viewport-height') !== nextHeight) {
          document.documentElement.style.setProperty('--mobile-viewport-height', nextHeight);
        }
        const editing = document.activeElement?.matches('input, textarea');
        if (!editing) unfocusedHeight = height;
        setKeyboardOpen(Boolean(editing && Math.max(unfocusedHeight, window.innerHeight) - height > 120));
      });
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.documentElement.style.removeProperty('--mobile-viewport-height');
    };
  }, [active]);
  return keyboardOpen;
}
