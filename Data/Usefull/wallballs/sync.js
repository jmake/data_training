function setupSync(ids) {
  let syncing = false;
  ids.forEach(srcId => {
    const el = document.getElementById(srcId);
    if (!el) return;
    el.on("plotly_relayout", ev => {
      if (syncing) return;
      syncing = true;
      let update = null;
      if (ev["xaxis.autorange"]) {
        update = { "xaxis.autorange": true };
      } else if (ev["xaxis.range[0]"] !== undefined) {
        update = { "xaxis.range": [ev["xaxis.range[0]"], ev["xaxis.range[1]"]] };
      } else if (ev["xaxis.range"]) {
        update = { "xaxis.range": [ev["xaxis.range"][0], ev["xaxis.range"][1]] };
      }
      if (update) {
        ids.forEach(tgtId => {
          if (tgtId !== srcId) {
            const tgtEl = document.getElementById(tgtId);
            if (tgtEl && tgtEl._fullLayout) {
              const tgtXa = tgtEl._fullLayout.xaxis;
              if (update["xaxis.range"]) {
                const r = update["xaxis.range"];
                if (tgtXa.autorange === false && tgtXa.range &&
                    Math.abs(tgtXa.range[0] - r[0]) < 1e-4 &&
                    Math.abs(tgtXa.range[1] - r[1]) < 1e-4) {
                  return;
                }
              }
              Plotly.relayout(tgtId, update);
            }
          }
        });
      }
      setTimeout(() => { syncing = false; }, 50);
    });
  });
}
