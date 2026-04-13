export type Theme = 'dark' | 'light';

export const DEFAULT_THEME: Theme = 'dark';
export const THEME_COOKIE_NAME = 'golden-circle-theme';
const THEME_CHANGE_EVENT = 'golden-circle-theme-change';

export function sanitizeTheme(value: string | null | undefined): Theme {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

export function readThemeFromDocument(): Theme {
  if (typeof document === 'undefined') {
    return DEFAULT_THEME;
  }

  return sanitizeTheme(document.documentElement.dataset.theme);
}

export function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function buildThemeScript(): string {
  return `(() => {
    const cookieName = '${THEME_COOKIE_NAME}=';
    const storedTheme = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(cookieName))
      ?.slice(cookieName.length);
    const theme = storedTheme === 'light' ? 'light' : '${DEFAULT_THEME}';
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  })();`;
}

export function subscribeToThemeChange(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

export function getThemeSnapshot(): Theme {
  return readThemeFromDocument();
}

export function getServerThemeSnapshot(): Theme {
  return DEFAULT_THEME;
}
