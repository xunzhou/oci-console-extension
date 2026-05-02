const OCID_RE = /\bocid1\.compartment\.[a-z0-9]+\.\.[a-zA-Z0-9]+\b/;

function parseCompartments(text) {
  const entries = {};
  try {
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    for (const item of items) {
      if (item.id?.startsWith('ocid1.compartment.') && item.name) entries[item.id] = item.name;
    }
    return entries;
  } catch {}
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const ocidMatch = line.match(OCID_RE);
    if (!ocidMatch) continue;
    const ocid = ocidMatch[0];
    const before = line.slice(0, line.indexOf(ocid)).replace(/[,:\t ]+$/, '').trim();
    if (before) entries[ocid] = before;
  }
  return entries;
}

function renderCacheInfo(data) {
  const count = Object.keys(data['compartment:names'] ?? {}).length;
  const fetchedAt = data['compartment:fetched_at'];
  let text = `${count} compartment${count !== 1 ? 's' : ''} cached`;
  if (fetchedAt) {
    const ago = Math.round((Date.now() - fetchedAt) / 60000);
    text += ` · fetched ${ago < 1 ? 'just now' : ago + 'm ago'}`;
  }
  document.getElementById('cache-info').textContent = text;
}

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status ' + (type ?? '');
  if (type === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

chrome.storage.local.get(null, (data) => {
  renderCacheInfo(data);
  document.getElementById('dev-mode').checked = !!data['dev-mode'];

  document.getElementById('comp-save').addEventListener('click', () => {
    const text = document.getElementById('comp-input').value.trim();
    if (!text) { setStatus('comp-status', 'Nothing to save', 'err'); return; }
    const entries = parseCompartments(text);
    const count = Object.keys(entries).length;
    if (count === 0) { setStatus('comp-status', 'No valid name+OCID pairs found', 'err'); return; }
    chrome.storage.local.get('compartment:names', (stored) => {
      const merged = Object.assign({}, stored['compartment:names'] ?? {}, entries);
      chrome.storage.local.set({ 'compartment:names': merged, 'compartment:fetched_at': Date.now() }, () => {
        document.getElementById('comp-input').value = '';
        renderCacheInfo({ ...data, 'compartment:names': merged, 'compartment:fetched_at': Date.now() });
        setStatus('comp-status', `Saved ${count} · ${Object.keys(merged).length} total`, 'ok');
      });
    });
  });

  document.getElementById('comp-clear').addEventListener('click', () => {
    chrome.storage.local.remove(['compartment:names', 'compartment:fetched_at'], () => {
      renderCacheInfo({});
      setStatus('comp-status', 'Cache cleared', 'ok');
    });
  });

  document.getElementById('dev-mode').addEventListener('change', (e) => {
    chrome.storage.local.set({ 'dev-mode': e.target.checked });
  });
});
