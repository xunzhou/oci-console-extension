function renderCompartmentStatus(data) {
  const count = Object.keys(data['compartment:names'] ?? {}).length;
  const fetchedAt = data['compartment:fetched_at'];
  document.getElementById('comp-count').textContent = `(${count})`;
  const statusEl = document.getElementById('comp-status');
  if (fetchedAt) {
    const ago = Math.round((Date.now() - fetchedAt) / 60000);
    statusEl.textContent = `fetched ${ago < 1 ? 'just now' : ago + 'm ago'}`;
  } else {
    statusEl.textContent = count > 0 ? '' : 'none cached — open Settings to import';
  }
}


function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(data) {
  const container = document.getElementById('discovered');
  const keys = Object.keys(data).filter((k) => k.startsWith('discovered:')).sort();

  if (keys.length === 0) {
    container.innerHTML = '<div class="empty">No tabs discovered yet.<br>Browse to OCI resource detail pages to collect tabs.</div>';
    return;
  }

  container.innerHTML = keys.map((key) => {
    const type = key.slice('discovered:'.length);
    const tabs = data[key];
    const rows = tabs.map(({ label, slug }) =>
      `<div class="tab-row"><span>${esc(label)}</span><span class="slug">${esc(slug)}</span></div>`
    ).join('');
    return `<div class="section">
      <div class="type-header">${esc(type)} <span class="count">(${tabs.length})</span></div>
      ${rows}
    </div>`;
  }).join('');
}

function buildExportJson(data) {
  const result = {};
  Object.entries(data)
    .filter(([k]) => k.startsWith('discovered:'))
    .forEach(([k, tabs]) => {
      result[k.slice('discovered:'.length)] = tabs.map(({ label, slug }) => [label, slug]);
    });
  return JSON.stringify(result, null, 2);
}

function scanCurrentTab() {
  const btn = document.getElementById('scan');
  btn.textContent = 'Scanning…';
  btn.disabled = true;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const OCI_HOSTS = /^https:\/\/(cloud\.oracle\.com|cloud\.oraclegovcloud\.uk|cloud\.oraclecloud(?:8|9|10|14|20)\.com|[^/]+\.oraclegovcloud\.com)\//;
    if (!tab || !OCI_HOSTS.test(tab.url)) {
      btn.textContent = 'Not an OCI tab';
      setTimeout(() => { btn.textContent = 'Scan current tab'; btn.disabled = false; }, 2000);
      return;
    }
    // First find the maui-preact iframe's frameId, then inject into it directly
    chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
      const iframe = frames.find(f => f.url.includes('maui-preact') || (f.url.includes('cloud.oracle.com') && f.frameId !== 0));
      const frameId = iframe ? iframe.frameId : 0;
      chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        world: 'MAIN',
        func: (topUrl) => {
          const OCID_IN_PATH = /\/ocid1\.[a-z][a-z0-9]*\.[a-z0-9]+\.[a-z0-9-]*\.[a-zA-Z0-9]+\//;
          const OCID_FULL_RE = /ocid1\.([a-z][a-z0-9]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9]+)/;
          const url = OCID_IN_PATH.test(topUrl) ? topUrl : location.href;
          if (!OCID_IN_PATH.test(url)) return { error: `no OCID in URL: ${url}` };
          const allMatches = [...url.split('?')[0].matchAll(new RegExp(OCID_FULL_RE.source, 'g'))];
          if (allMatches.length === 0) return { error: 'OCID parse failed' };
          const ocidMatch = allMatches[allMatches.length - 1];
          const type = ocidMatch[1];
          const urlSlug = url.split('?')[0].split('/').filter(Boolean).pop();
          const isSentinel = (k) => /^[A-Z_]+$/.test(k);
          const tabEls = [...document.querySelectorAll('[role="tablist"] [role="tab"][data-oj-key]')];
          if (tabEls.length < 2) return { error: `tab bar not rendered (${tabEls.length} elements) — click a non-default tab first` };
          const tabs = tabEls.map((el) => {
            const key = el.getAttribute('data-oj-key');
            const isSelected = el.getAttribute('aria-selected') === 'true';
            const slug = (isSentinel(key) && isSelected) ? urlSlug : isSentinel(key) ? null : key;
            return { slug, label: el.textContent.trim().replace(/\s+/g, ' ') };
          }).filter(({ slug, label }) => slug && label);
          return { type, tabs };
        },
        args: [tab.url],
      }, ([result]) => {
      btn.textContent = 'Scan current tab';
      btn.disabled = false;
      if (chrome.runtime.lastError || !result?.result) {
        document.getElementById('discovered').innerHTML =
          `<div class="empty">Error: ${chrome.runtime.lastError?.message ?? 'no result returned'}</div>`;
        return;
      }
      const { type, tabs, error } = result.result;
      if (error) {
        document.getElementById('discovered').innerHTML = `<div class="empty">${error}</div>`;
        return;
      }
      const key = `discovered:${type}`;
      chrome.storage.local.get(key, (data) => {
        const existing = data[key] ?? [];
        const seen = new Set(existing.map((t) => t.slug));
        const merged = [...existing, ...tabs.filter((t) => !seen.has(t.slug))];
        chrome.storage.local.set({ [key]: merged }, () => {
          chrome.storage.local.get(null, render);
        });
      });
      });
    });
  });
}

chrome.storage.local.get(null, (data) => {
  document.getElementById('dev-sections').style.display = data['dev-mode'] ? 'block' : 'none';
  renderCompartmentStatus(data);
  render(data);

  document.getElementById('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('scan').addEventListener('click', scanCurrentTab);

  document.getElementById('copy-ocid').addEventListener('click', () => {
    const btn = document.getElementById('copy-ocid');
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const OCID_RE = /(ocid1\.[a-z][a-z0-9]*\.[a-z0-9]+\.[a-z0-9-]*\.[a-zA-Z0-9]+)/;
      const match = tab?.url?.match(OCID_RE);
      if (!match) {
        btn.textContent = 'No OCID found';
        setTimeout(() => { btn.textContent = 'Copy OCID'; }, 2000);
        return;
      }
      navigator.clipboard.writeText(match[1]).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy OCID'; }, 1500);
      });
    });
  });

  document.getElementById('export').addEventListener('click', () => {
    const json = buildExportJson(data);
    const area = document.getElementById('export-area');
    const ta = document.getElementById('json-out');
    ta.value = json;
    area.style.display = 'block';
    ta.select();
    navigator.clipboard.writeText(json).then(() => {
      document.getElementById('export').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('export').textContent = 'Copy JSON'; }, 1500);
    });
  });

  document.getElementById('clear').addEventListener('click', () => {
    const keys = Object.keys(data).filter((k) => k.startsWith('discovered:'));
    chrome.storage.local.remove(keys, () => {
      document.getElementById('export-area').style.display = 'none';
      render({});
    });
  });
});
