// ── Status pill ──
function setStatus(cls, text) {
  const pill = document.getElementById("status-pill");
  pill.className = cls;
  document.getElementById("status-text").textContent = text;
}

// ── Render cached data for a tab ──
function renderIfVisible(name) {
  const key = cacheKey(name);
  if (!sessionCache[key]) return;
  const data = sessionCache[key];
  renderStats(name, data.stats);
  const firstInit = !inited[name];
  renderCharts(name, data, firstInit);
  if (firstInit) {
    inited[name] = true;
    fftRun(name);   // auto-run FFT on first data load
  }
}

// ── Tab switching ──
let activeTab = "wallballs";

function resizeTab(name) {
  const p = SESSIONS[name].prefix;
  ["hr", "mag", "ax", "ay", "az", "fft-time", "fft-freq", "fft-template", "fft-aligned"].forEach(c => {
    const el = document.getElementById(`${p}-${c}`);
    if (el && el.layout) Plotly.Plots.resize(el);
  });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;
    activeTab = tab;

    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");

    const key = cacheKey(tab);
    if (!sessionCache[key]) {
      await fetchSession(tab);
      renderIfVisible(tab);
    } else if (!inited[tab]) {
      renderIfVisible(tab);
    } else {
      setTimeout(() => resizeTab(tab), 30);
    }
  });
});

// ── Cleaning method selector ──
document.querySelectorAll(".clean-select").forEach(sel => {
  sel.addEventListener("change", async () => {
    const name = sel.dataset.tab;
    cleanMethod[name] = sel.value;
    const ok = await fetchSession(name);
    if (ok) renderIfVisible(name);
  });
});

// ── Boot ──
(async () => {
  await fetchSession("wallballs");
  renderIfVisible("wallballs");
  document.getElementById("loading-overlay").classList.add("hidden");
})();

// ── Poll: active tab only ──
setInterval(async () => {
  const ok = await fetchSession(activeTab);
  if (ok && sessionCache[cacheKey(activeTab)]) renderIfVisible(activeTab);
}, POLL_MS);
