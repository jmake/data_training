async function fetchSession(name) {
  const key   = cacheKey(name);
  const clean = cleanMethod[name];
  const url   = SESSIONS[name].url + `?clean=${clean}`;
  const headers = {};
  if (etags[key]) headers["If-None-Match"] = etags[key];

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    setStatus("error", "Server unreachable");
    return false;
  }

  if (res.status === 304) {
    setStatus("live", "Live · no change");
    return true;
  }
  if (!res.ok) {
    setStatus("error", `HTTP ${res.status}`);
    return false;
  }

  etags[key] = res.headers.get("ETag");
  sessionCache[key] = await res.json();
  setStatus("live", "Live");
  return true;
}
