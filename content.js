// Scrapes the tab bar on OCI resource detail pages and stores discovered tabs
// in chrome.storage.local under "discovered:{type}".
//
// OCI Console renders tabs as div[role="tab"][data-oj-key] inside a
// div[role="tablist"]. There are no <a href> elements — the active tab slug
// is reflected in the URL path instead. We read data-oj-key for the slug and
// the inner text for the label.

// Guard against re-injection: the MutationObserver persists in the isolated
// world, so a second executeScript call should be a no-op.
if (!window.__ociEnhancerLoaded) {
window.__ociEnhancerLoaded = true;

const OCID_IN_PATH = /\/ocid1\.[a-z][a-z0-9]*\.[a-z0-9]+\.[a-z0-9-]*\.[a-zA-Z0-9]+\//;
const OCID_FULL_RE = /ocid1\.([a-z][a-z0-9]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9]+)/;

function scrape() {
  // The tab bar lives in an iframe; use the top frame's URL for the OCID
  const url = window === window.top ? location.href : window.top.location.href;
  if (!OCID_IN_PATH.test(url)) return;

  // Use the last OCID in the path — child resource URLs contain both parent and
  // child OCIDs (e.g. /domains/{domain-ocid}/users/{user-ocid}) and we want the leaf type.
  const path = url.split('?')[0];
  const allMatches = [...path.matchAll(new RegExp(OCID_FULL_RE.source, 'g'))];
  if (allMatches.length === 0) return;
  const ocidMatch = allMatches[allMatches.length - 1];
  const type = ocidMatch[1];

  const tabEls = [...document.querySelectorAll('[role="tablist"] [role="tab"][data-oj-key]')];
  if (tabEls.length < 2) return;

  // Some tabs use an internal sentinel key (e.g. "DETAILS_GROUP_KEY") instead
  // of a real URL slug. For the selected tab we can read the real slug from the
  // URL path; for others the data-oj-key is authoritative.
  const urlSlug = url.split('?')[0].split('/').filter(Boolean).pop();
  const isSentinel = (key) => /^[A-Z_]+$/.test(key); // all-caps = internal key

  const tabs = tabEls.map((el) => {
    const key = el.getAttribute('data-oj-key');
    const isSelected = el.getAttribute('aria-selected') === 'true';
    const slug = (isSentinel(key) && isSelected) ? urlSlug : isSentinel(key) ? null : key;
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    return { slug, label };
  }).filter(({ slug, label }) => slug && label);

  if (tabs.length === 0) return;

  const key = `discovered:${type}`;
  chrome.storage.local.get(key, (data) => {
    const existing = data[key] ?? [];
    const seen = new Set(existing.map((t) => t.slug));
    const merged = [...existing, ...tabs.filter((t) => !seen.has(t.slug))];
    chrome.storage.local.set({ [key]: merged });
  });
}

// OCI lazily mounts the tab bar — it's absent on the initial (default) tab render.
// Watch for it to appear in the DOM, scrape once when it does, then also re-scrape
// on SPA navigation.
const topHref = () => {
  try { return window.top.location.href; } catch { return location.href; }
};

let lastUrl = topHref();
let lastScrapedUrl = '';

new MutationObserver(() => {
  const currentUrl = topHref();
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    lastScrapedUrl = '';
    compartmentScraped = false;
    compListScraped = false;
  }
  if (currentUrl !== lastScrapedUrl) {
    const hasTabBar = document.querySelector('[role="tablist"] [role="tab"][data-oj-key]');
    if (hasTabBar) {
      lastScrapedUrl = currentUrl;
      scrape();
    }
  }
  if (!compartmentScraped) {
    const hasTree = document.querySelector('li[id^="oj-oci-treeview-item-ocid1.compartment"]');
    if (hasTree) {
      compartmentScraped = true;
      scrapeCompartments();
    }
  }
  if (!compListScraped && document.querySelector(COMP_LINK_SEL)) {
    compListScraped = true;
    scrapeCompartmentsList();
  }
}).observe(document.body, { childList: true, subtree: true });

// Scrape the compartment picker treeview whenever it renders.
// DOM: li[id^="oj-oci-treeview-item-ocid1.compartment"] with a <bdi> child for the name.
let compartmentScraped = false;
function scrapeCompartments() {
  const items = document.querySelectorAll('li[id^="oj-oci-treeview-item-ocid1.compartment"]');
  if (items.length === 0) return;
  const entries = {};
  items.forEach((li) => {
    const ocid = li.id.replace('oj-oci-treeview-item-', '');
    const name = li.querySelector('bdi')?.textContent?.trim();
    if (ocid && name) entries[ocid] = name;
  });
  if (Object.keys(entries).length === 0) return;
  chrome.storage.local.get('compartment:names', (data) => {
    const merged = Object.assign({}, data['compartment:names'] ?? {}, entries);
    chrome.storage.local.set({ 'compartment:names': merged });
  });
}

// Scrape the flat compartments list page (/identity/compartments).
// Each compartment is rendered as <a href="/identity/compartments/{ocid}/details">Name</a>.
const COMP_LINK_SEL = 'a[href*="/identity/compartments/ocid1.compartment"]';
const COMP_LINK_RE = /\/identity\/compartments\/(ocid1\.compartment\.[^/?#]+)/;
let compListScraped = false;

function scrapeCompartmentsList() {
  const links = document.querySelectorAll(COMP_LINK_SEL);
  if (links.length === 0) return;
  const entries = {};
  links.forEach(a => {
    const m = a.href.match(COMP_LINK_RE);
    const name = a.textContent.trim();
    if (m && name && name.length < 256) entries[m[1]] = name;
  });
  if (Object.keys(entries).length === 0) return;
  chrome.storage.local.get('compartment:names', (data) => {
    const merged = Object.assign({}, data['compartment:names'] ?? {}, entries);
    chrome.storage.local.set({ 'compartment:names': merged, 'compartment:fetched_at': Date.now() });
  });
}

// Extract and cache the object storage namespace from bucket page URLs.
// Pattern: /object-storage/buckets/{namespace}/{bucket-name}/...
// Namespace never changes per tenancy so caching indefinitely is fine.
(() => {
  try {
    const topUrl = window === window.top ? location.href : window.top.location.href;
    const m = topUrl.match(/\/object-storage\/buckets\/([^/]+)\/[^/]+/);
    if (!m) return;
    const ns = m[1];
    const region = new URLSearchParams(topUrl.split('?')[1] ?? '').get('region');
    if (!region) return;
    chrome.storage.local.set({ [`namespace:${region}`]: ns, 'namespace:last_region': region });
  } catch {}
})();

// Cache compartmentId from any page URL.
(() => {
  try {
    const topUrl = window === window.top ? location.href : window.top.location.href;
    const compartmentId = new URLSearchParams(topUrl.split('?')[1] ?? '').get('compartmentId');
    if (!compartmentId) return;
    chrome.storage.local.set({ 'compartment:last': compartmentId });
  } catch {}
})();

// Cache recently-visited regions as a MRU list (up to 5).
(() => {
  try {
    const topUrl = window === window.top ? location.href : window.top.location.href;
    const region = new URLSearchParams(topUrl.split('?')[1] ?? '').get('region');
    if (!region) return;
    chrome.storage.local.get('region:recent', (data) => {
      let list = data['region:recent'] ?? [];
      list = [region, ...list.filter((r) => r !== region)].slice(0, 5);
      chrome.storage.local.set({ 'region:recent': list });
    });
  } catch {}
})();

} // end __ociEnhancerLoaded guard
