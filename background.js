// OCID format: ocid1.<type>.<realm>.<region>.<unique>
// Region is the 4th dot-separated segment (index 3)
const OCID_PATTERN = /ocid1\.[a-z0-9]+\.[a-z0-9]+\.([a-z0-9-]+)\.[a-z0-9]+/i;

// OCI OCIDs use 3-letter airport codes for some regions; the console ?region= param
// requires the full region identifier. Map only the short codes; hyphenated regions pass through.
const REGION_CODE_MAP = {
  iad: 'us-ashburn-1',
  phx: 'us-phoenix-1',
  ord: 'us-chicago-1',
  sjc: 'us-sanjose-1',
  fra: 'eu-frankfurt-1',
  ams: 'eu-amsterdam-1',
  mad: 'eu-madrid-1',
  orf: 'eu-madrid-3',
  cdg: 'eu-paris-1',
  lin: 'eu-milan-1',
  nrq: 'eu-turin-1',
  arn: 'eu-stockholm-1',
  mrs: 'eu-marseille-1',
  zrh: 'eu-zurich-1',
  beg: 'eu-jovanovac-1',
  lhr: 'uk-london-1',
  cwl: 'uk-cardiff-1',
  nrt: 'ap-tokyo-1',
  icn: 'ap-seoul-1',
  yny: 'ap-chuncheon-1',
  bom: 'ap-mumbai-1',
  hyd: 'ap-hyderabad-1',
  sin: 'ap-singapore-1',
  xsp: 'ap-singapore-2',
  syd: 'ap-sydney-1',
  mel: 'ap-melbourne-1',
  kix: 'ap-osaka-1',
  hsg: 'ap-batam-1',
  jbp: 'ap-kulai-2',
  wga: 'ap-dcc-canberra-1',
  yyz: 'ca-toronto-1',
  yul: 'ca-montreal-1',
  gru: 'sa-saopaulo-1',
  vcp: 'sa-vinhedo-1',
  bog: 'sa-bogota-1',
  scl: 'sa-santiago-1',
  vap: 'sa-valparaiso-1',
  jed: 'me-jeddah-1',
  dxb: 'me-dubai-1',
  auh: 'me-abudhabi-1',
  ruh: 'me-riyadh-1',
  jnb: 'af-johannesburg-1',
  lej: 'af-casablanca-1',
  mtz: 'il-jerusalem-1',
  qro: 'mx-queretaro-1',
  mty: 'mx-monterrey-1',
};

// All known OCI regions for partial-name search; derived from REGION_CODE_MAP values.
const ALL_REGIONS = [...new Set(Object.values(REGION_CODE_MAP))];

// Fallback region when no context is available (first OCI commercial region).
const DEFAULT_REGION = 'us-ashburn-1';

// Returns the first region whose full name contains the query as a substring.
// Also handles exact airport-code matches via REGION_CODE_MAP.
function searchRegion(q) {
  const lower = q.toLowerCase();
  if (REGION_CODE_MAP[lower]) return REGION_CODE_MAP[lower];
  return ALL_REGIONS.find((r) => r.includes(lower)) ?? null;
}

function resolveRegionCode(code) {
  return REGION_CODE_MAP[code] ?? code;
}

function extractRegionFromUrl(url) {
  const match = url.match(OCID_PATTERN);
  if (!match) return null;
  const regionSegment = match[1];
  if (REGION_CODE_MAP[regionSegment]) return REGION_CODE_MAP[regionSegment];
  // Skip realm-level segments that aren't regions (e.g. "oc1" has no region part)
  // Real region segments contain at least one hyphen and end with a digit, e.g. "eu-madrid-1"
  if (!/^[a-z].*-\d+$/.test(regionSegment)) return null;
  return regionSegment;
}

function buildCorrectedUrl(urlStr, region) {
  const url = new URL(urlStr);
  const current = url.searchParams.get("region");
  if (current === region) return null; // already correct
  url.searchParams.set("region", region);
  return url.toString();
}

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return; // main frame only

    const region = extractRegionFromUrl(details.url);
    if (!region) return;

    const corrected = buildCorrectedUrl(details.url, region);
    if (!corrected) return;

    // Redirect to the corrected URL
    chrome.tabs.update(details.tabId, { url: corrected });
  },
  { url: [
    { hostEquals: 'cloud.oracle.com' },
    { hostEquals: 'cloud.oraclegovcloud.uk' },
    { hostEquals: 'cloud.oraclecloud8.com' },
    { hostEquals: 'cloud.oraclecloud9.com' },
    { hostEquals: 'cloud.oraclecloud10.com' },
    { hostEquals: 'cloud.oraclecloud14.com' },
    { hostEquals: 'cloud.oraclecloud20.com' },
    { hostSuffix: '.oraclegovcloud.com' },
  ] }
);

// ─── Commands ────────────────────────────────────────────────────────────────

const OCID_IN_URL_RE = /(ocid1\.[a-z][a-z0-9]*\.[a-z0-9]+\.[a-z0-9-]*\.[a-zA-Z0-9]+)/;

function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'copy-ocid') return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const match = tab?.url?.match(OCID_IN_URL_RE);
    if (!match) { flashBadge('✕', '#c00'); return; }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (ocid) => navigator.clipboard.writeText(ocid),
      args: [match[1]],
    }).then(() => flashBadge('✓', '#2a8a2a'));
  });
});

// ─── Omnibox: navigate to OCI resource by OCID ───────────────────────────────

const OCID_FULL_RE = /^ocid1\.([a-z][a-z0-9]*)\.([a-z0-9]+)\.([a-z0-9-]*)\.([a-zA-Z0-9]*)$/;

function parseOcid(raw) {
  const m = raw.trim().match(OCID_FULL_RE);
  if (!m) return null;
  const rawRegion = m[3] || null;
  return { raw: raw.trim(), type: m[1], realm: m[2], region: rawRegion ? resolveRegionCode(rawRegion) : null, unique: m[4] };
}

const REALM_HOSTS = {
  oc1:  'https://cloud.oracle.com',
  oc4:  'https://cloud.oraclegovcloud.uk',
  oc8:  'https://cloud.oraclecloud8.com',
  oc9:  'https://cloud.oraclecloud9.com',
  oc10: 'https://cloud.oraclecloud10.com',
  oc14: 'https://cloud.oraclecloud14.com',
  oc20: 'https://cloud.oraclecloud20.com',
};

// oc2 and oc3 use region-specific subdomains: console.{region}.oraclegovcloud.com
const REALM_REGIONAL_DOMAINS = {
  oc2: 'oraclegovcloud.com',
  oc3: 'oraclegovcloud.com',
};

function getRealmBase(realm, region) {
  if (REALM_REGIONAL_DOMAINS[realm] && region) {
    return `https://console.${region}.${REALM_REGIONAL_DOMAINS[realm]}`;
  }
  return REALM_HOSTS[realm] ?? 'https://cloud.oracle.com';
}

// Values are either a path string ("{base}/{ocid}") or [prefix, segment] ("{base}/{segment}/{ocid}")
const DIRECT_PATHS = {
  instance:            '/compute/instances',
  volume:              '/block-storage/volumes',
  volumebackup:        '/block-storage/volume-backups',
  bootvolume:          '/block-storage/boot-volumes',
  vcn:                 '/networking/vcns',
  loadbalancer:        ['/load-balancer',             'load-balancers'],
  networkloadbalancer: ['/networking/load-balancers',    'network-load-balancer'],
  dbsystem:            '/database/dbsystems',
  autonomousdatabase:  '/database/autonomous-databases',
  mysqldbsystem:       '/mysql/dbsystems',
  cluster:             '/containers/clusters',
  drg:                 '/networking/drgs',
  internetgateway:     '/networking/internet-gateways',
  filesystem:          '/file-storage/file-systems',
  image:               '/compute/images',
  dedicatedvmhost:     '/compute/dedicated-vm-hosts',
  compartment:         '/identity/compartments',
  policy:              ['/identity/domains/policies', 'policies'],
  domain:              '/identity/domains',
};

// Per-type tab slugs; first entry is the default (Enter with no suggestion selected).
// Validated from live OCI console via tab discovery tool.
const TABS = {
  instance: [
    ['Details',        'details'],
    ['Networking',     'networking'],
    ['Storage',        'storage'],
    ['Security',       'security'],
    ['Management',     'management'],
    ['OS Management',  'os-management'],
    ['Monitoring',     'monitoring'],
    ['Work requests',  'work-requests'],
    ['Tags',           'tags'],
  ],
  vcn: [
    ['Details',               'details'],
    ['IP administration',     'ip-administration'],
    ['Subnets',               'subnets'],
    ['Gateways',              'gateways'],
    ['Routing',               'routing'],
    ['Private service access','psa'],
    ['Security',              'security'],
    ['VLANs',                 'vlans'],
    ['Work requests',         'work-requests'],
    ['Tags',                  'tags'],
  ],
  volume: [
    ['Details',           'general'],
    ['Attached instances','attached-instances'],
    ['Backups',           'volume-backups-tab'],
    ['Clones',            'volume-clones'],
    ['Replicas',          'block-volume-replicas'],
    ['Monitoring',        'volume-metrics'],
    ['Tags',              'tags'],
  ],
  loadbalancer: [
    ['Details',                 'details'],
    ['Listeners',               'listeners'],
    ['Backend sets',            'backend-sets'],
    ['Policies',                'policies'],
    ['Certificates and ciphers','certificates-ciphers'],
    ['Hostnames',               'hostnames'],
    ['Security',                'securityAttributes'],
    ['Monitoring',              'monitoring'],
    ['Work requests',           'work-requests'],
    ['Tags',                    'tags'],
  ],
  networkloadbalancer: [
    ['Details',       'details'],
    ['Backend sets',  'backend-sets'],
    ['Listeners',     'listeners'],
    ['Monitoring',    'monitoring'],
    ['Work requests', 'work-requests'],
    ['Security',      'security'],
    ['Tags',          'tags'],
  ],
  cluster: [
    ['Cluster details',              'details'],
    ['Node pools',                   'node-pools'],
    ['Add-ons',                      'add-ons'],
    ['Work requests',                'work-requests'],
    ['Monitoring',                   'metrics'],
    ['Quick start: Deploy sample app','quick-start'],
    ['Image verification',           'image-verification'],
    ['Path analysis tests',          'npa'],
    ['Tags',                         'tags'],
  ],
  filesystem: [
    ['Details',              'details'],
    ['Exports',              'exports'],
    ['Snapshots',            'snapshots'],
    ['Replications',         'replications'],
    ['Clones',               'clones'],
    ['User and group quotas','quotas'],
    ['Monitoring',           'monitoring'],
    ['Tags',                 'tags'],
  ],
  dbsystem: [
    ['Details',   'information'],
    ['Nodes',     'nodes'],
    ['Backups',   'backups'],
    ['Metrics',   'metrics'],
    ['Tags',      'tags'],
  ],
  autonomousdatabase: [
    ['Details',     'information'],
    ['Connections', 'db-connections'],
    ['Backups',     'backups'],
    ['Metrics',     'metrics'],
    ['Tags',        'tags'],
  ],
  compartment: [
    ['Details',        'details'],
    ['Work requests',  'work-requests'],
    ['Tag defaults',   'tag-defaults'],
    ['Tags',           'tags'],
  ],
  policy: [
    ['Policy information', 'details'],
    ['Statements',         'policy-statements'],
    ['Tags',               'tags'],
  ],
  domain: [
    ['Details',                 'details'],
    ['User management',         'users'],
    ['Administrators',          'administrators'],
    ['Dynamic groups',          'dynamic-groups'],
    ['Directory integrations',  'directory-integrations'],
    ['Integrated applications', 'applications'],
    ['Oracle cloud services',   'services'],
    ['Federation',              'federation'],
    ['Domain policies',         'policy-managements'],
    ['Security',                'security'],
    ['Authentication',          'authentication'],
    ['Branding',                'branding-settings'],
    ['Settings',                'settings'],
    ['Schema management',       'schema-management'],
    ['App gateways',            'ssoBridges'],
    ['Reporting',               'reports'],
    ['Notifications',           'notification-settings'],
    ['Tags',                    'tags'],
  ],
};

const BUCKET_TABS = [
  ['Details',       'details'],
  ['Objects',       'objects'],
  ['Management',    'management'],
  ['Monitoring',    'monitoring'],
  ['Policies',      'policies'],
  ['Work requests', 'work-requests'],
  ['Tags',          'tags'],
];

const FALLBACK_PATHS = {
  subnet:       { path: '/networking/subnets',       reason: 'needs parent VCN OCID' },
  routetable:   { path: '/networking/vcns',           reason: 'needs parent VCN OCID' },
  securitylist: { path: '/networking/vcns',           reason: 'needs parent VCN OCID' },
  dhcpoptions:  { path: '/networking/vcns',           reason: 'needs parent VCN OCID' },
  bucket:       { path: '/object-storage/buckets',    reason: 'URL uses namespace/name not OCID' },
  nodepool:     { path: '/containers/clusters',       reason: 'needs parent cluster OCID' },
};

// Resources whose URL requires a parent OCID.
// Supply both OCIDs in the omnibox (any order) to navigate directly.
const CHILD_RESOURCES = {
  nodepool: {
    parentType: 'cluster',
    buildPath: (parentRaw, childRaw) => `/containers/clusters/${parentRaw}/node-pools/${childRaw}`,
    tabs: [
      ['Details',           'provisioned'],
      ['Nodes',             'nodes'],
      ['VNICs',             'vnics'],
      ['Kubernetes labels', 'kubernetesLabels'],
    ],
  },
  user: {
    parentType: 'domain',
    buildPath: (parentRaw, childRaw) => `/identity/domains/${parentRaw}/users/${childRaw}`,
    tabs: [
      ['Details',                        'details'],
      ['Groups',                         'groups'],
      ['Integrated applications',        'user-access'],
      ['API keys',                       'api-keys'],
      ['Auth tokens',                    'auth-token'],
      ['OAuth 2.0 client credentials',   'oauth2-credentials'],
      ['SMTP credentials',               'smtp-credentials'],
      ['Customer secret keys',           'secret-keys'],
      ['Database passwords',             'db-passwords'],
    ],
  },
  group: {
    parentType: 'domain',
    buildPath: (parentRaw, childRaw) => `/identity/domains/${parentRaw}/groups/${childRaw}`,
    tabs: [
      ['Details', 'details'],
    ],
  },
};

function findChildPair(parsedList) {
  for (const child of parsedList) {
    const info = CHILD_RESOURCES[child.type];
    if (!info) continue;
    const parent = parsedList.find((p) => p.type === info.parentType && p !== child);
    if (parent) return { parent, child, info };
  }
  return null;
}

const ALL_TYPES = [...Object.keys(DIRECT_PATHS), ...Object.keys(FALLBACK_PATHS)];

function xmlEsc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildConsoleUrl(parsed, compartment) {
  const base = getRealmBase(parsed.realm, parsed.region);
  const regionParam = parsed.region ? `?region=${parsed.region}` : '';

  if (DIRECT_PATHS[parsed.type]) {
    const entry = DIRECT_PATHS[parsed.type];
    const resourcePath = Array.isArray(entry)
      ? `${entry[0]}/${entry[1]}/${parsed.raw}`
      : `${entry}/${parsed.raw}`;
    const tabs = (TABS[parsed.type] ?? []).map(([label, slug]) => ({
      label,
      url: `${base}${resourcePath}/${slug}${regionParam}`,
    }));
    return {
      url: `${base}${resourcePath}${regionParam}`,
      isDirect: true,
      label: `${parsed.type} in ${parsed.region ?? parsed.realm}`,
      tabs,
    };
  }
  if (FALLBACK_PATHS[parsed.type]) {
    const { path, reason } = FALLBACK_PATHS[parsed.type];
    const comp = compartment ?? cachedCompartment;
    const compartmentSuffix = comp
      ? `${regionParam ? '&' : '?'}compartmentId=${comp}`
      : '';
    return {
      url: `${base}${path}${regionParam}${compartmentSuffix}`,
      isDirect: false,
      label: `${parsed.type} — list page (${reason})`,
    };
  }
  return {
    url: `${base}/${regionParam}`,
    isDirect: false,
    label: `unknown type "${parsed.type}" — console root`,
  };
}

function recordTabHit(type, slug) {
  const key = `freq:${type}:${slug}`;
  chrome.storage.local.get(key, (data) => {
    chrome.storage.local.set({ [key]: (data[key] ?? 0) + 1 });
  });
}

async function sortTabsByFreq(type, tabs) {
  const keys = tabs.map(({ url }) => {
    const slug = url.split('?')[0].split('/').pop();
    return `freq:${type}:${slug}`;
  });
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => {
      const scored = tabs.map((tab, i) => ({ tab, count: data[keys[i]] ?? 0 }));
      scored.sort((a, b) => b.count - a.count);
      resolve(scored.map((s) => s.tab));
    });
  });
}

// ─── History ─────────────────────────────────────────────────────────────────

const HISTORY_MAX = 20;
const HISTORY_KEY = 'history';

async function appendHistory(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      let hist = data[HISTORY_KEY] ?? [];
      hist = hist.filter((h) => h.url !== entry.url);
      hist.unshift(entry);
      if (hist.length > HISTORY_MAX) hist.length = HISTORY_MAX;
      chrome.storage.local.set({ [HISTORY_KEY]: hist }, resolve);
    });
  });
}

async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => resolve(data[HISTORY_KEY] ?? []));
  });
}

// Returns a map of { [ocid]: bestRegion } derived from history (MRU).
// Falls back to recentRegions[0] for compartments with no history.
async function bestRegionPerCompartment(ocids, recentRegions) {
  const hist = await getHistory();
  const result = {};
  for (const { url } of hist) {
    try {
      const u = new URL(url);
      const comp = u.searchParams.get('compartmentId');
      const region = u.searchParams.get('region');
      if (comp && region && ocids.includes(comp) && !result[comp]) {
        result[comp] = region;
      }
    } catch {}
  }
  // Fill missing with top recent region
  const fallback = recentRegions[0];
  for (const ocid of ocids) {
    if (!result[ocid]) result[ocid] = fallback;
  }
  return result;
}

// ─── Compartment cache ────────────────────────────────────────────────────────

let cachedCompartment = null;

chrome.storage.local.get('compartment:last', (data) => {
  cachedCompartment = data['compartment:last'] ?? null;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes['compartment:last']) cachedCompartment = changes['compartment:last'].newValue ?? null;
});

function resolveNavigationUrl(text, storageData) {
  const trimmed = text.trim();
  const parsed = parseOcid(trimmed);
  if (parsed) return buildConsoleUrl(parsed, storageData?.['compartment:last']).url;
  try { const u = new URL(trimmed); if (u.protocol === 'https:') return trimmed; } catch {}
  const toksAll = trimmed.split(/\s+/);
  const parsedAll = toksAll.map(parseOcid).filter(Boolean);
  // Child resource: two OCIDs with a parent-child relationship (e.g. cluster + nodepool)
  const childPairNav = parsedAll.length >= 2 ? findChildPair(parsedAll) : null;
  if (childPairNav) {
    const { parent, child, info } = childPairNav;
    const base = getRealmBase(child.realm, child.region);
    const regionParam = child.region ? `?region=${child.region}` : '';
    const resourcePath = info.buildPath(parent.raw, child.raw);
    const firstOcidIdx = toksAll.findIndex((t) => OCID_FULL_RE.test(t));
    const filter = toksAll.slice(firstOcidIdx + 1).filter((t) => !OCID_FULL_RE.test(t)).join(' ').toLowerCase().trim();
    if (filter) {
      const match = info.tabs.find(([label]) => label.toLowerCase().includes(filter));
      if (match) return `${base}${resourcePath}/${match[1]}${regionParam}`;
    }
    return `${base}${resourcePath}/${info.tabs[0][1]}${regionParam}`;
  }
  const firstOcid = parsedAll[0] ?? null;
  if (firstOcid) {
    const result = buildConsoleUrl(firstOcid);
    if (result.isDirect && result.tabs.length > 0) {
      const toks = toksAll;
      const ocidIdx = toks.findIndex((t) => OCID_FULL_RE.test(t));
      const filter = toks.slice(ocidIdx + 1).filter((t) => !OCID_FULL_RE.test(t)).join(' ').toLowerCase().trim();
      if (filter) {
        const match = result.tabs.find(({ label }) => label.toLowerCase().includes(filter));
        if (match) return match.url;
      }
    }
    return result.url;
  }
  // Resource type keyword: "instance [region] [compartment]"
  const toks = toksAll;
  const colonIdx = trimmed.lastIndexOf(':');
  const typeKw = (colonIdx > 0 ? trimmed.slice(0, colonIdx) : toks[0]).toLowerCase();
  const afterColon = colonIdx > 0 ? trimmed.slice(colonIdx + 1) : null;
  const regionTok = afterColon ?? (toks.length > 1 ? toks[1] : null);
  const explicitRegion = regionTok ? searchRegion(regionTok) : null;
  if (DIRECT_PATHS[typeKw] !== undefined || FALLBACK_PATHS[typeKw] !== undefined) {
    const region = explicitRegion ?? (storageData?.['namespace:last_region']) ?? DEFAULT_REGION;
    const entry = DIRECT_PATHS[typeKw] ?? FALLBACK_PATHS[typeKw]?.path ?? '/';
    const pathStr = Array.isArray(entry) ? entry[0] : (typeof entry === 'object' ? entry.path : entry);
    const compQuery = toks.length > 1
      ? (explicitRegion ? toks.slice(2) : toks.slice(1)).join(' ').toLowerCase() || null
      : null;
    const namesMap = storageData?.['compartment:names'] ?? {};
    const matchedOcid = compQuery
      ? (Object.entries(namesMap).find(([, name]) => name.toLowerCase().includes(compQuery))?.[0] ?? null)
      : null;
    const compartment = matchedOcid ?? storageData?.['compartment:last'];
    const compartmentParam = compartment ? `&compartmentId=${compartment}` : '';
    return `https://cloud.oracle.com${pathStr}?region=${region}${compartmentParam}`;
  }
  // Bucket name fallback
  if (storageData) {
    const bucketName = colonIdx > 0 ? trimmed.slice(0, colonIdx) : toksAll[0];
    const regionQuery = colonIdx > 0 ? trimmed.slice(colonIdx + 1) : (toksAll.length > 1 ? toksAll[1] : null);
    const region = (regionQuery ? searchRegion(regionQuery) : null)
      ?? storageData['namespace:last_region'] ?? DEFAULT_REGION;
    const ns = storageData[`namespace:${region}`];
    if (ns) return `https://cloud.oracle.com/object-storage/buckets/${ns}/${encodeURIComponent(bucketName)}/objects?region=${region}`;
    return `https://cloud.oracle.com/object-storage/buckets?region=${region}`;
  }
  return 'https://cloud.oracle.com/';
}

chrome.omnibox.setDefaultSuggestion({
  description: 'Paste an OCID — e.g. <dim>ocid1.instance.oc1.eu-madrid-1.&lt;unique&gt;</dim>',
});

const REGION_SWITCH_RE = /^:.+$/;
const COMP_SWITCH_RE = /^>.*/;

const HELP_TEXT = 'ocid · ocid tab · type · type region · type region comp · bucket region · :region · >comp · ?';

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const trimmed = text.trim();

  if (trimmed === '?') {
    chrome.omnibox.setDefaultSuggestion({ description: HELP_TEXT });
    suggest([
      { content: '?ocid',    description: '<match>ocid</match> — navigate to resource: <dim>ocid1.instance.oc1.eu-madrid-1.&lt;unique&gt;</dim>' },
      { content: '?ocid',    description: '<match>ocid tab</match> — open specific tab: <dim>ocid1.instance… monitoring</dim>' },
      { content: '?type',    description: '<match>type</match> — resource list: <dim>instance · vcn · volume · cluster · policy · user …</dim>' },
      { content: '?type',    description: '<match>type region comp</match> — filtered list: <dim>instance ashburn prod</dim>' },
      { content: '?bucket',  description: '<match>bucket region</match> — bucket page: <dim>mybucket ashburn</dim>' },
      { content: '?:region', description: '<match>:region</match> — switch region: <dim>:tokyo · :iad · :eu-madrid-1</dim>' },
      { content: '?>comp',   description: '<match>&gt;comp</match> — switch compartment: <dim>&gt;prod · &gt;dev</dim>' },
    ]);
    return;
  }

  if (!trimmed) {
    Promise.all([getHistory(), new Promise((res) => chrome.storage.local.get('region:recent', (d) => res(d['region:recent'] ?? [])))]).then(([hist, recentRegions]) => {
      const histItems = hist.slice(0, 4);
      const regionItems = recentRegions.slice(0, 3);
      const suggestions = [];

      if (histItems.length === 0 && regionItems.length === 0) {
        chrome.omnibox.setDefaultSuggestion({ description: HELP_TEXT });
        suggest([]);
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        for (const r of regionItems) {
          if (suggestions.length >= 3) break;
          let url = null;
          if (tab?.url) {
            try { const u = new URL(tab.url); u.searchParams.set('region', r); url = u.toString(); } catch {}
          }
          if (url) suggestions.push({ content: url, description: `<dim>region:</dim> ${xmlEsc(r)}` });
        }
        for (const h of histItems) {
          suggestions.push({ content: h.url, description: `<dim>recent:</dim> ${xmlEsc(h.label)}` });
        }

        const first = regionItems[0]
          ? `<dim>region:</dim> ${xmlEsc(regionItems[0])}`
          : `<dim>recent:</dim> ${xmlEsc(histItems[0].label)}`;
        chrome.omnibox.setDefaultSuggestion({ description: first });
        suggest(suggestions.slice(1));
      });
    });
    return;
  }

  if (COMP_SWITCH_RE.test(trimmed)) {
    const query = trimmed.slice(1).trim().toLowerCase();
    chrome.storage.local.get(['compartment:names', 'compartment:last'], (data) => {
      const namesMap = data['compartment:names'] ?? {};
      const entries = Object.entries(namesMap);
      if (entries.length === 0) {
        chrome.omnibox.setDefaultSuggestion({
          description: '<dim>No compartments cached — open Settings to import</dim>',
        });
        suggest([]);
        return;
      }
      const matches = query
        ? entries.filter(([, name]) => name.toLowerCase().includes(query))
        : entries;
      matches.sort(([, a], [, b]) => a.localeCompare(b));
      const top = matches.slice(0, 6);
      if (top.length === 0) {
        chrome.omnibox.setDefaultSuggestion({
          description: `<dim>No compartment matches</dim> <match>${xmlEsc(query)}</match>`,
        });
        suggest([]);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        const toSuggestion = ([ocid, name]) => {
          let url = ocid;
          if (tab?.url) {
            try { const u = new URL(tab.url); u.searchParams.set('compartmentId', ocid); url = u.toString(); } catch {}
          }
          return { content: url, description: `<dim>compartment:</dim> <match>${xmlEsc(name)}</match>` };
        };
        chrome.omnibox.setDefaultSuggestion({ description: `<dim>compartment:</dim> <match>${xmlEsc(top[0][1])}</match>` });
        suggest(top.slice(1).map(toSuggestion));
      });
    });
    return;
  }

  if (REGION_SWITCH_RE.test(trimmed)) {
    const query = trimmed.slice(1);
    const region = searchRegion(query);
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!region) {
        chrome.omnibox.setDefaultSuggestion({
          description: `<dim>No region matches</dim> <match>${xmlEsc(query)}</match>`,
        });
        suggest([]);
        return;
      }
      const desc = `Switch current page to <match>${xmlEsc(region)}</match>`;
      const suggestions = [];
      if (tab?.url) {
        try {
          const u = new URL(tab.url);
          u.searchParams.set('region', region);
          suggestions.push({ content: u.toString(), description: desc });
        } catch {}
      }
      chrome.omnibox.setDefaultSuggestion({ description: desc });
      suggest(suggestions);
    });
    return;
  }

  const firstToken = trimmed.split(' ')[0];
  if (firstToken.startsWith('ocid1.') && !OCID_FULL_RE.test(firstToken)) {
    chrome.omnibox.setDefaultSuggestion({
      description: '<dim>Waiting for complete OCID…</dim>  ocid1.&lt;type&gt;.&lt;realm&gt;.&lt;region&gt;.&lt;unique&gt;',
    });
    suggest([]);
    return;
  }

  const tokens = trimmed.split(/\s+/);
  const parsedList = tokens.map(parseOcid).filter(Boolean);

  if (parsedList.length === 0) {
    const colonIdx = trimmed.lastIndexOf(':');
    const afterColon = colonIdx > 0 ? trimmed.slice(colonIdx + 1) : null;
    const looksLikeBucket = !afterColon || /^[a-z][a-z0-9-]+-\d+$/.test(afterColon);

    // Check if input is a known resource type keyword.
    // Format: "instance [region] [compartment-query]"
    // token[0]=type, token[1]=optional region (resolved via searchRegion), token[2+]=compartment substring filter
    const typeKeyword = (colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : tokens[0]).toLowerCase();
    const regionToken = afterColon ?? (tokens.length > 1 ? tokens[1] : null);
    const explicitRegionKeyword = regionToken ? searchRegion(regionToken) : null;
    // compartment query: tokens after the region token (if resolved), otherwise tokens[1] onward
    const compartmentQuery = tokens.length > 1
      ? (explicitRegionKeyword ? tokens.slice(2) : tokens.slice(1)).join(' ').toLowerCase() || null
      : null;
    const isKnownType = DIRECT_PATHS[typeKeyword] !== undefined || FALLBACK_PATHS[typeKeyword] !== undefined;

    if (isKnownType) {
      const storageKeys = ['compartment:last', 'namespace:last_region', 'region:recent', 'compartment:names'];
      chrome.storage.local.get(storageKeys, (data) => {
        const fallbackRegion = data['namespace:last_region'] ?? DEFAULT_REGION;
        const recentRegions = explicitRegionKeyword
          ? [explicitRegionKeyword]
          : (data['region:recent']?.length ? data['region:recent'] : [fallbackRegion]);
        const base = 'https://cloud.oracle.com';
        const entry = DIRECT_PATHS[typeKeyword] ?? FALLBACK_PATHS[typeKeyword]?.path ?? '/';
        const pathStr = Array.isArray(entry) ? entry[0] : (typeof entry === 'object' ? entry.path : entry);

        // Resolve compartment: filter cached names by query, fall back to last-visited
        const namesMap = data['compartment:names'] ?? {};
        let matchedCompartments = null;
        if (compartmentQuery) {
          const q = compartmentQuery.toLowerCase();
          matchedCompartments = Object.entries(namesMap)
            .filter(([, name]) => name.toLowerCase().includes(q))
            .slice(0, 3); // cap at 3 to avoid suggestion overflow
        }

        const firstRegion = recentRegions[0];
        const regionDesc = explicitRegionKeyword
          ? `<match>${xmlEsc(firstRegion)}</match>`
          : `<dim>${xmlEsc(firstRegion)}</dim>`;

        if (matchedCompartments && matchedCompartments.length > 0) {
          const firstComp = matchedCompartments[0];
          // With explicit region: cross region × compartment.
          // Without: look up history to find which regions each compartment was used in,
          // then show one suggestion per compartment using its best region.
          if (explicitRegionKeyword) {
            const suggestions = [];
            for (const r of recentRegions) {
              for (const [ocid, name] of matchedCompartments) {
                if (suggestions.length >= 6) break;
                const url = `${base}${pathStr}?region=${r}&compartmentId=${ocid}`;
                suggestions.push({ content: url, description: `<match>${xmlEsc(typeKeyword)}</match> · <dim>${xmlEsc(r)}</dim> · <match>${xmlEsc(name)}</match> · <url>${xmlEsc(url)}</url>` });
              }
            }
            chrome.omnibox.setDefaultSuggestion({
              description: `<match>${xmlEsc(typeKeyword)}</match> list · ${regionDesc} · <match>${xmlEsc(firstComp[1])}</match>`,
            });
            suggest(suggestions);
          } else {
            const ocids = matchedCompartments.map(([ocid]) => ocid);
            bestRegionPerCompartment(ocids, recentRegions).then((regionMap) => {
              const suggestions = matchedCompartments.slice(0, 6).map(([ocid, name]) => {
                const r = regionMap[ocid];
                const url = `${base}${pathStr}?region=${r}&compartmentId=${ocid}`;
                return { content: url, description: `<match>${xmlEsc(typeKeyword)}</match> · <match>${xmlEsc(name)}</match> · <dim>${xmlEsc(r)}</dim> · <url>${xmlEsc(url)}</url>` };
              });
              chrome.omnibox.setDefaultSuggestion({
                description: `<match>${xmlEsc(typeKeyword)}</match> list · <dim>${xmlEsc(regionMap[ocids[0]])}</dim> · <match>${xmlEsc(firstComp[1])}</match>`,
              });
              suggest(suggestions);
            });
          }
        } else {
          const fallbackCompartment = data['compartment:last'];
          const compartmentParam = fallbackCompartment ? `&compartmentId=${fallbackCompartment}` : '';
          const noNamesHint = compartmentQuery && Object.keys(namesMap).length === 0
            ? ' <dim>(open compartment picker to cache names)</dim>' : '';
          const compDesc = compartmentQuery
            ? ` · <dim>no match</dim>${noNamesHint}`
            : (fallbackCompartment ? ` · <dim>compartment cached</dim>` : '');
          chrome.omnibox.setDefaultSuggestion({
            description: `<match>${xmlEsc(typeKeyword)}</match> list · ${regionDesc}${compDesc} — add <dim>region compartment</dim> to filter`,
          });
          suggest(recentRegions.map((r) => {
            const url = `${base}${pathStr}?region=${r}${compartmentParam}`;
            return { content: url, description: `<match>${xmlEsc(typeKeyword)}</match> list · <dim>${xmlEsc(r)}</dim> · <url>${xmlEsc(url)}</url>` };
          }));
        }
      });
      return;
    }

    // Tab completion: prefix matches one or more known type keywords
    const typeMatches = ALL_TYPES.filter((t) => t.startsWith(typeKeyword) && t.length > typeKeyword.length);
    if (typeMatches.length > 0 && tokens.length === 1) {
      chrome.omnibox.setDefaultSuggestion({
        description: `<match>${xmlEsc(typeMatches[0])}</match> · <dim>list page</dim>`,
      });
      suggest(typeMatches.slice(1).map((t) => ({
        content: t,
        description: `<match>${xmlEsc(t)}</match> · <dim>list page</dim>`,
      })));
      return;
    }

    // Bare region name/code/partial: single token that resolves to a known region
    if (tokens.length === 1 && !afterColon) {
      const resolvedRegion = searchRegion(trimmed);
      if (resolvedRegion) {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          const desc = `Switch current page to <match>${xmlEsc(resolvedRegion)}</match>`;
          const suggestions = [];
          if (tab?.url) {
            try {
              const u = new URL(tab.url);
              u.searchParams.set('region', resolvedRegion);
              suggestions.push({ content: u.toString(), description: desc });
            } catch {}
          }
          chrome.omnibox.setDefaultSuggestion({ description: desc });
          suggest(suggestions);
        });
        return;
      }
    }

    if (!looksLikeBucket) {
      // Search history labels (Feature 5)
      getHistory().then((hist) => {
        const q = trimmed.toLowerCase();
        const matches = hist.filter((h) => h.label.toLowerCase().includes(q)).slice(0, 6);
        if (matches.length > 0) {
          chrome.omnibox.setDefaultSuggestion({
            description: `<dim>history:</dim> ${xmlEsc(matches[0].label)}`,
          });
          suggest(matches.slice(1).map((h) => ({
            content: h.url,
            description: `<dim>history:</dim> ${xmlEsc(h.label)}`,
          })));
        } else {
          chrome.omnibox.setDefaultSuggestion({
            description: `<dim>No history matches for</dim> <match>${xmlEsc(trimmed)}</match>`,
          });
          suggest([]);
        }
      });
      return;
    }

    // Treat as bucket name, optionally "name:region" or "name region"
    const bucketName = colonIdx > 0 ? trimmed.slice(0, colonIdx) : tokens[0];
    const regionQuery = afterColon ?? (tokens.length > 1 ? tokens[1] : null);
    const explicitRegion = regionQuery ? searchRegion(regionQuery) : null;
    const storageKeys = ['namespace:last_region'];
    if (explicitRegion) storageKeys.push(`namespace:${explicitRegion}`);
    chrome.storage.local.get(storageKeys, (data) => {
      const region = explicitRegion ?? data['namespace:last_region'] ?? DEFAULT_REGION;
      const ns = data[`namespace:${region}`];
      const base = 'https://cloud.oracle.com';
      chrome.omnibox.setDefaultSuggestion({
        description: ns
          ? `bucket <match>${xmlEsc(bucketName)}</match> · <dim>${region}</dim>`
          : `bucket <match>${xmlEsc(bucketName)}</match> · <dim>namespace unknown — browse OCI first</dim>`,
      });
      if (ns) {
        suggest(BUCKET_TABS.map(([label, slug]) => ({
          content: `${base}/object-storage/buckets/${ns}/${encodeURIComponent(bucketName)}/${slug}?region=${region}`,
          description: `<match>${xmlEsc(bucketName)}</match> · <dim>${xmlEsc(label)}</dim> · <dim>${region}</dim>`,
        })));
      } else {
        suggest([{
          content: `${base}/object-storage/buckets?region=${region}`,
          description: `<dim>bucket list</dim> · ${xmlEsc(region)} <dim>(visit any OCI page to cache namespace)</dim>`,
        }]);
      }
    });
    return;
  }

  // Extract tab filter: tokens that are not OCIDs, appearing after the first OCID token
  const firstOcidTokenIdx = tokens.findIndex((t) => OCID_FULL_RE.test(t));
  const tabFilter = tokens.slice(firstOcidTokenIdx + 1)
    .filter((t) => !OCID_FULL_RE.test(t))
    .join(' ')
    .toLowerCase()
    .trim();

  // Handle child resources that need a parent OCID (e.g. nodepool → cluster)
  const childPair = parsedList.length >= 2 ? findChildPair(parsedList) : null;
  if (childPair) {
    const { parent, child, info } = childPair;
    const base = getRealmBase(child.realm, child.region);
    const regionParam = child.region ? `?region=${child.region}` : '';
    const resourcePath = info.buildPath(parent.raw, child.raw);
    const allTabs = info.tabs.map(([label, slug]) => ({
      label,
      url: `${base}${resourcePath}/${slug}${regionParam}`,
    }));
    const filtered = tabFilter
      ? allTabs.filter(({ label }) => label.toLowerCase().includes(tabFilter))
      : allTabs;
    const tabsToSort = filtered.length > 0 ? filtered : allTabs;
    const typeLabel = xmlEsc(child.type);
    const regionLabel = xmlEsc(child.region ?? child.realm);
    sortTabsByFreq(child.type, tabsToSort).then((sorted) => {
      chrome.omnibox.setDefaultSuggestion({
        description: `<match>${typeLabel}</match> · ${regionLabel} · <dim>${sorted[0].label}</dim>`,
      });
      suggest(sorted.map(({ label, url }) => ({
        content: url,
        description: `<match>${typeLabel}</match> · <dim>${xmlEsc(label)}</dim> · <url>${xmlEsc(url)}</url>`,
      })));
    });
    return;
  }

  const parsed = parsedList[0];
  const result = buildConsoleUrl(parsed);
  const multiNote = parsedList.length > 1 ? '  <dim>(using first of multiple OCIDs)</dim>' : '';

  if (result.isDirect) {
    const regionLabel = xmlEsc(parsed.region ?? parsed.realm);
    const typeLabel = xmlEsc(parsed.type);
    if (result.tabs.length > 0 || tabFilter) {
      chrome.storage.local.get(`discovered:${parsed.type}`, (data) => {
        const discovered = data[`discovered:${parsed.type}`] ?? [];
        const base = getRealmBase(parsed.realm, parsed.region);
        const regionParam = parsed.region ? `?region=${parsed.region}` : '';
        const entry = DIRECT_PATHS[parsed.type];
        const resourcePath = Array.isArray(entry)
          ? `${entry[0]}/${entry[1]}/${parsed.raw}`
          : `${entry}/${parsed.raw}`;
        const hardcodedSlugs = new Set((TABS[parsed.type] ?? []).map(([, s]) => s));
        const extraTabs = discovered
          .filter(({ slug }) => !hardcodedSlugs.has(slug))
          .map(({ label, slug }) => ({ label, url: `${base}${resourcePath}/${slug}${regionParam}` }));
        const allTabs = [...result.tabs, ...extraTabs];
        const filtered = tabFilter
          ? allTabs.filter(({ label }) => label.toLowerCase().includes(tabFilter))
          : allTabs;
        const tabsToSort = filtered.length > 0 ? filtered : allTabs;
        sortTabsByFreq(parsed.type, tabsToSort).then((sorted) => {
          chrome.omnibox.setDefaultSuggestion({
            description: `<match>${typeLabel}</match> · ${regionLabel} · <dim>${sorted[0].label}</dim>${multiNote}`,
          });
          suggest(sorted.map(({ label, url }) => ({
            content: url,
            description: `<match>${typeLabel}</match> · <dim>${xmlEsc(label)}</dim> · <url>${xmlEsc(url)}</url>`,
          })));
        });
      });
    } else {
      chrome.omnibox.setDefaultSuggestion({
        description: `Navigate to <match>${typeLabel}</match> in <dim>${regionLabel}</dim>${multiNote}`,
      });
      suggest([{
        content: result.url,
        description: `<match>${typeLabel}</match> · ${regionLabel} · <url>${xmlEsc(result.url)}</url>`,
      }]);
    }
  } else {
    chrome.omnibox.setDefaultSuggestion({
      description: `<dim>List page:</dim> <match>${xmlEsc(parsed.type)}</match> — ${xmlEsc(result.label)}${multiNote}`,
    });
    suggest([{
      content: result.url,
      description: `<dim>Best effort:</dim> <match>${xmlEsc(parsed.type)}</match> list → <url>${xmlEsc(result.url)}</url>`,
    }]);
  }
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const trimmed = text.trim();

  if (trimmed === '?') return;

  // Compartment switcher: >query or bare ocid passed as content from suggestion
  if (COMP_SWITCH_RE.test(trimmed)) {
    const query = trimmed.slice(1).trim().toLowerCase();
    chrome.storage.local.get('compartment:names', (data) => {
      const namesMap = data['compartment:names'] ?? {};
      const match = Object.entries(namesMap).find(([, name]) => name.toLowerCase().includes(query));
      if (!match) return;
      const [ocid] = match;
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab?.url) return;
        try {
          const u = new URL(tab.url);
          u.searchParams.set('compartmentId', ocid);
          navigateTo(u.toString(), disposition);
        } catch {}
      });
    });
    return;
  }
  // Compartment switch via suggestion content (full URL already built)
  if (trimmed.startsWith('https://') && trimmed.includes('compartmentId=ocid1.compartment')) {
    navigateTo(trimmed, disposition);
    return;
  }

  // Region switcher
  if (REGION_SWITCH_RE.test(trimmed)) {
    const region = searchRegion(trimmed.slice(1));
    if (!region) return;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.url) return;
      try {
        const u = new URL(tab.url);
        u.searchParams.set('region', region);
        navigateTo(u.toString(), disposition);
      } catch {}
    });
    return;
  }

  // Bare region name/code/partial with no colon prefix
  if (!trimmed.includes(' ') && !trimmed.startsWith(':')) {
    const bareRegion = searchRegion(trimmed);
    if (bareRegion) {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab?.url) return;
        try {
          const u = new URL(tab.url);
          u.searchParams.set('region', bareRegion);
          navigateTo(u.toString(), disposition);
        } catch {}
      });
      return;
    }
  }

  const isUrl = /^https:/.test(trimmed);
  const needsBucketLookup = !isUrl && !parseOcid(trimmed)
    && !trimmed.split(/\s+/).map(parseOcid).find(Boolean);

  const proceed = (url) => {
    // Record tab hit for frequency ranking
    const parsed = parseOcid(trimmed.split(/\s+/).find((t) => OCID_FULL_RE.test(t)) ?? '');
    if (parsed && TABS[parsed.type]) {
      const typeTabs = TABS[parsed.type];
      const hit = typeTabs.find(([, slug]) => url.includes(`/${slug}?`) || url.includes(`/${slug}&`));
      if (hit) recordTabHit(parsed.type, hit[1]);
    }
    // Record to history
    const histLabel = buildHistoryLabel(trimmed, url);
    if (histLabel) appendHistory({ url, label: histLabel, ts: Date.now() });
    navigateTo(url, disposition);
  };

  if (needsBucketLookup) {
    const colonIdx = trimmed.lastIndexOf(':');
    const toks = trimmed.split(/\s+/);
    const regionQuery = colonIdx > 0 ? trimmed.slice(colonIdx + 1) : (toks.length > 1 ? toks[1] : null);
    const region = regionQuery ? searchRegion(regionQuery) : null;
    const keys = ['namespace:last_region', 'compartment:last', 'compartment:names', ...(region ? [`namespace:${region}`] : [])];
    chrome.storage.local.get(keys, (data) => proceed(resolveNavigationUrl(trimmed, data)));
  } else {
    proceed(isUrl ? trimmed : resolveNavigationUrl(trimmed, { 'compartment:last': cachedCompartment }));
  }
});

function navigateTo(url, disposition) {
  switch (disposition) {
    case 'currentTab':
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.id) chrome.tabs.update(tab.id, { url });
        else chrome.tabs.create({ url });
      });
      break;
    case 'newForegroundTab':
      chrome.tabs.create({ url, active: true });
      break;
    case 'newBackgroundTab':
      chrome.tabs.create({ url, active: false });
      break;
  }
}

function buildHistoryLabel(text, url) {
  try {
    const u = new URL(url);
    const region = u.searchParams.get('region') ?? '';
    const parsed = parseOcid(text.split(/\s+/).find((t) => OCID_FULL_RE.test(t)) ?? '');
    if (parsed) {
      const pathParts = u.pathname.split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1];
      const tabEntry = TABS[parsed.type]?.find(([, s]) => s === slug);
      const tabLabel = tabEntry ? tabEntry[0] : slug;
      return `${parsed.type} · ${region || parsed.region || parsed.realm} · ${tabLabel}`;
    }
    // Type keyword list page: e.g. "instance" or "instance us-phoenix-1" → "instance list · us-chicago-1"
    const colonIdx = text.lastIndexOf(':');
    const typeKw = (colonIdx > 0 ? text.slice(0, colonIdx) : text.trim().split(/\s+/)[0]).toLowerCase();
    if (DIRECT_PATHS[typeKw] !== undefined || FALLBACK_PATHS[typeKw] !== undefined) {
      return `${typeKw} list · ${region}`;
    }
    // Bucket or other URL: derive a label from the path
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts.includes('buckets')) {
      const bucketIdx = pathParts.indexOf('buckets');
      const name = pathParts[bucketIdx + 2] ?? '';
      if (name) return `bucket · ${region} · ${decodeURIComponent(name)}`;
    }
    return null;
  } catch {
    return null;
  }
}
