// Runs before the app paints so dark mode does not flash light first.
try {
  var saved = localStorage.getItem('rr-theme');
  var dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {}
