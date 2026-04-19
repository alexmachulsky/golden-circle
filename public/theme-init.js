(() => {
  const cookieName = "golden-circle-theme=";
  const storedTheme = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(cookieName))
    ?.slice(cookieName.length);
  const theme = storedTheme === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
})();
