function fmt_duration(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function renderStats(name, st) {
  const accent = SESSIONS[name].accent;
  const card = (label, value, unit) =>
    `<div class="stat-card ${accent}">
       <div class="stat-label">${label}</div>
       <div class="stat-value">${value}<span class="stat-unit">${unit}</span></div>
     </div>`;

  document.getElementById(`acc-stats-${name}`).innerHTML = [
    card("ACC RMS",     st.acc_rms,                    "g"),
    card("Sample Rate", st.sample_rate,                 "Hz"),
    card("ACC Points",  st.acc_samples.toLocaleString(), ""),
  ].join("");

  document.getElementById(`hr-stats-${name}`).innerHTML = [
    card("Duration", fmt_duration(st.duration_s), "min"),
    card("Avg HR",   st.hr_avg,                   "bpm"),
    card("Max HR",   st.hr_max,                   "bpm"),
    card("Min HR",   st.hr_min,                   "bpm"),
  ].join("");
}
