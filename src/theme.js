// Runs before CSS is painted to avoid a light flash when reopening a dark workspace.
(() => {
  const key = "fantasyperf.theme.v1";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const normalize = (value) =>
    ["light", "dark", "system"].includes(value) ? value : "system";
  let preference = "system";
  try {
    preference = normalize(localStorage.getItem(key));
  } catch {}
  function apply() {
    document.documentElement.dataset.theme =
      preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.themeMode = preference;
    const select = document.getElementById("theme-mode");
    if (select) select.value = preference;
    window.dispatchEvent(new Event("fantasyperf-theme-change"));
  }
  apply();
  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === key || e.key === null) {
      preference = normalize(e.newValue);
      apply();
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("theme-mode");
    select.value = preference;
    select.addEventListener("change", () => {
      preference = normalize(select.value);
      try {
        localStorage.setItem(key, preference);
      } catch {
        window.dispatchEvent(new Event("fantasyperf-theme-storage-error"));
      }
      apply();
    });
  });
})();
