/**
 * Kea Growth Ops: brand-name organic-search monitoring.
 *
 * This extends the existing Growth Ops project only. It uses its existing
 * Shopify Admin and Search Console OAuth paths and writes to the existing
 * dashboard spreadsheet. It never changes Shopify catalog or SEO data.
 */
const KEA_BRAND_RANK_SUMMARY_SHEET_ = 'BrandSEOBrandRank';
const KEA_BRAND_RANK_QUERY_SHEET_ = 'BrandSEOQueries';
const KEA_BRAND_RANK_TECH_SHEET_ = 'BrandSEOTechnical';
const KEA_BRAND_RANK_LEASE_KEY_ = 'KEA_BRAND_RANK_MONITOR_LEASE_V1';
const KEA_BRAND_RANK_TRIGGER_HANDLER_ = 'runBrandNameRankMonitor';

const KEA_BRAND_RANK_SUMMARY_HEADERS_ = [
  'checkedAt', 'window', 'windowStart', 'windowEnd', 'brand', 'english',
  'japanese', 'notationVariants', 'collectionUrl', 'productCount',
  'brandQuery', 'brandQueryClicks', 'brandQueryImpressions', 'brandQueryCtr',
  'brandQueryPosition', 'googleSelectedLandingPage',
  'collectionLandingPage', 'collectionClicks', 'collectionImpressions',
  'collectionCtr', 'collectionPosition', 'top10Collection',
  'gscRowsComplete', 'notes', 'inStockProductCount',
];

const KEA_BRAND_RANK_QUERY_HEADERS_ = [
  'checkedAt', 'window', 'windowStart', 'windowEnd', 'brand', 'axis',
  'query', 'queryVariant', 'category', 'productHandle', 'productTitle',
  'productCode', 'clicks', 'impressions', 'ctr', 'position',
  'googleSelectedLandingPage', 'collectionUrl', 'collectionClicks',
  'collectionImpressions', 'collectionCtr', 'collectionPosition',
  'gscRowsComplete', 'queryAvailable',
];

const KEA_BRAND_RANK_TECH_HEADERS_ = [
  'checkedAt', 'brand', 'collectionUrl', 'productCount', 'indexed', 'verdict',
  'coverageState', 'indexingState', 'robotsTxtState', 'lastCrawlTime',
  'googleCanonical', 'shopifyCanonical', 'canonicalMatches', 'httpStatus',
  'finalHttpStatus', 'redirectLocation', 'title', 'descriptionPresent',
  'bodyPresent', 'collectionRuleOk', 'oldEcUrl', 'oldEcStatus',
  'oldEcLocation', 'oldEcTargetExpected', 'oldEcOneToOne',
];

// Search aliases only; this reference never writes Shopify SEO or product data.
// Company references checked 2026-09-20; qualifications remain visible per query.
const KEA_BRAND_QUERY_REFERENCES_ = {
  "77circa": {
    "aliases": [
      "77サーカ",
      "ナナナナサーカ"
    ],
    "companies": [
      "ERA, Inc",
      "ERA"
    ],
    "source": "https://es-77circa.com/policies/legal-notice"
  },
  "Agapantha Jewelry": {
    "aliases": [
      "AGAPANTHA",
      "アガパンサ"
    ],
    "companies": [
      "Agapantha Jewelry"
    ],
    "source": "https://www.agapantha.com/pages/faq",
    "note": "公式事業表記 Agapantha Jewelry。海外の個人による運営（取引先確認）"
  },
  "BATONER": {
    "aliases": [
      "バトナー"
    ],
    "companies": [
      "有限会社奥山メリヤス",
      "奥山メリヤス",
      "OKUYAMA MERIYASU"
    ],
    "source": "https://www.batoner.com/contact/"
  },
  "Button Works": {
    "aliases": [
      "ボタンワークス"
    ],
    "companies": [
      "株式会社ビー・エスアンドティー",
      "ビー・エスアンドティー"
    ],
    "source": "https://buttonworks.thebase.in/law"
  },
  "COEL": {
    "aliases": [
      "コエル"
    ],
    "companies": [
      "株式会社ビッグヒット",
      "ビッグヒット"
    ],
    "source": "https://ec.coel-y.net/shop/pages/company.aspx"
  },
  "Chloé": {
    "aliases": [
      "Chloe",
      "クロエ"
    ],
    "companies": [
      "Richemont",
      "リシュモン"
    ],
    "source": "https://www.chloe.com/ja-jp/sustainability/products.html",
    "note": "ブランド親会社"
  },
  "LEVI'S": {
    "aliases": [
      "Levi's®",
      "リーバイス"
    ],
    "companies": [
      "リーバイ・ストラウス ジャパン株式会社",
      "リーバイストラウスジャパン"
    ],
    "source": "https://levi.jp/pages/about-us"
  },
  "MONOEARTH": {
    "aliases": [
      "モノアース"
    ],
    "companies": [
      "モノアースアンドカンパニー株式会社",
      "モノアースアンドカンパニー"
    ],
    "source": "https://monoearth.jp/pages/company"
  },
  "Oblada": {
    "aliases": [
      "オブラダ"
    ],
    "companies": [
      "株式会社CINCH",
      "CINCH",
      "シンチ"
    ],
    "source": "https://cinch-inc.com/pages/company-1"
  },
  "SEA": {
    "aliases": [
      "シー"
    ],
    "companies": [
      "株式会社ピア",
      "PIER INC."
    ],
    "source": "https://www.riescloset.com/me"
  },
  "SINME": {
    "aliases": [
      "シンメ"
    ],
    "companies": [
      "有限会社チェルシーフィルムズ",
      "チェルシーフィルムズ"
    ],
    "source": "https://sinme.shop-pro.jp/?mode=sk"
  },
  "SUICOKE": {
    "aliases": [
      "スイコック"
    ],
    "companies": [
      "株式会社INOD",
      "INOD"
    ],
    "source": "https://suicoke.com/pages/terms-conditions",
    "verifiedProductCategories": {
      "product-7272": {
        "categories": ["バッグ"],
        "source": "https://store.kea.co.jp/products/product-7272"
      }
    }
  },
  "Velnica": {
    "aliases": [
      "ヴェルニカ"
    ],
    "companies": [
      "株式会社VelnicaRoom",
      "VelnicaRoom"
    ],
    "source": "https://velnica.com/blog/law/"
  },
  "blurhms": {
    "aliases": [
      "ブラームス"
    ],
    "companies": [
      "株式会社WONDERISM",
      "WONDERISM",
      "ワンダリズム"
    ],
    "source": "https://nestbowl.com/company/268676e3-ba0c-4090-ae01-92f693f3f675"
  },
  "kit・sch": {
    "aliases": [
      "KITSCH",
      "キッチュ"
    ],
    "companies": [
      "KITSCH LLC",
      "KITSCH, LLC"
    ],
    "source": "https://www.mykitsch.com/ja-jp/pages/privacy-policy-terms-of-use"
  },
  "mikomori": {
    "aliases": [
      "ミコモリ"
    ],
    "companies": [
      "株式会社AKM",
      "AKM"
    ],
    "source": "https://mikomori.us.com/policies/legal-notice",
    "note": "現行公式サイトの特定商取引法に基づく表記：販売事業者 株式会社AKM"
  }
};

/** Include current SEO spellings and explicit search aliases. */
function brandRankAliases_(entry) {
  const vendor = String(entry && entry.vendor || '').trim();
  const title = String(entry && entry.collection && entry.collection.seo &&
    entry.collection.seo.title || '');
  const reference = KEA_BRAND_QUERY_REFERENCES_[vendor] || {};
  const values = [vendor].concat(reference.aliases || []);
  const parentheses = title.match(/[（(]([^（）()]+)[）)]/g) || [];
  parentheses.forEach(function (value) {
    values.push(value.replace(/[（）()]/g, '').trim());
  });
  if (vendor) {
    values.push(vendor.replace(/®/g, '').trim());
    values.push(vendor.replace(/[’']/g, '').trim());
    values.push(vendor.replace(/[・]/g, '').trim());
    values.push(vendor.replace(/\s+/g, '').trim());
  }
  const seen = {};
  return values.filter(function (value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function brandRankJapaneseAliases_(aliases) {
  return (aliases || []).filter(function (value) {
    return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ''));
  });
}

function brandRankCategories_(entry, vendorProducts) {
  const reference = KEA_BRAND_QUERY_REFERENCES_[String(entry && entry.vendor || '')] || {};
  if (reference.verifiedProductCategories) {
    // A verified-product override must never fall back to title-derived guesses.
    const categories = [];
    (vendorProducts || []).forEach(function (product) {
      if (product.vendor !== entry.vendor || product.status !== 'ACTIVE' ||
          !product.publishedAt || !product.onlineStoreUrl) return;
      const verified = reference.verifiedProductCategories[product.handle];
      (verified && verified.categories || []).forEach(function (category) {
        if (categories.indexOf(category) < 0) categories.push(category);
      });
    });
    return categories;
  }
  const title = String(entry && entry.collection && entry.collection.seo &&
    entry.collection.seo.title || '');
  const pieces = title.split('｜').map(function (value) { return value.trim(); });
  const last = pieces.length > 1 ? pieces[pieces.length - 1] : '';
  if (!last || /Kea\.|正規取扱|通販/.test(last)) return [];
  const seen = {};
  return last.split(/[・、,/]/).map(function (value) {
    return value.trim();
  }).filter(function (value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function brandRankNormalizeQuery_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function brandRankCurrentWindows_() {
  return [
    { key: 'last_28d', start: dateDaysAgo_(30), end: dateDaysAgo_(3) },
    { key: 'previous_28d', start: dateDaysAgo_(58), end: dateDaysAgo_(31) },
    { key: 'last_3m', start: dateDaysAgo_(92), end: dateDaysAgo_(3) },
    { key: 'previous_3m', start: dateDaysAgo_(182), end: dateDaysAgo_(93) },
  ];
}

/** Existing Search Console OAuth, with query and landing page in one request. */
function brandRankSearchConsoleQueryPageRows_(config, startDate, endDate) {
  const rows = searchConsoleAnalytics_(
    config, startDate, endDate, ['query', 'page'], 25000,
  );
  return { rows: rows, complete: rows.length < 25000 };
}

function brandRankProductCatalog_(config) {
  let after = null;
  const products = [];
  do {
    const data = shopifyGraphql_(
      config,
      'query KeaBrandRankProducts($after: String) {' +
        ' products(first: 250, after: $after, query: "status:active", sortKey: UPDATED_AT, reverse: true) {' +
        '  nodes {' +
        '   title handle vendor status publishedAt onlineStoreUrl' +
        '   productCode: metafield(namespace: "custom", key: "product_code") { value }' +
        '  }' +
        '  pageInfo { hasNextPage endCursor }' +
        ' }' +
        '}',
      { after: after },
      'Shopify brand rank product catalog',
    );
    const connection = data.products || { nodes: [], pageInfo: {} };
    (connection.nodes || []).forEach(function (product) {
      if (product.status === 'ACTIVE' && product.publishedAt &&
          product.onlineStoreUrl && !brandSeoExcludedVendor_(product.vendor)) {
        products.push(product);
      }
    });
    after = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor : null;
  } while (after);
  return products;
}

function brandRankTargetRows_(entries, products) {
  const rows = [];
  const seen = {};
  function add(row) {
    const query = String(row.query || '').replace(/\s+/g, ' ').trim();
    if (!query && !row.unavailable) return;
    const key = [row.brand, row.axis, brandRankNormalizeQuery_(query),
      row.productHandle || ''].join('|');
    if (seen[key]) return;
    seen[key] = true;
    row.query = query;
    rows.push(row);
  }
  const byVendor = {};
  (products || []).forEach(function (product) {
    const vendor = String(product.vendor || '');
    if (!byVendor[vendor]) byVendor[vendor] = [];
    byVendor[vendor].push(product);
  });
  (entries || []).forEach(function (entry) {
    const aliases = brandRankAliases_(entry);
    const categories = brandRankCategories_(entry, byVendor[entry.vendor] || []);
    aliases.forEach(function (alias) {
      add({ brand: entry.vendor, axis: 'ブランド名単体', query: alias,
        queryVariant: brandRankJapaneseAliases_([alias]).length ? '日本語' : '英字・表記',
        collectionUrl: entry.collectionUrl });
      add({ brand: entry.vendor, axis: 'ブランド名＋通販', query: alias + ' 通販',
        queryVariant: alias, collectionUrl: entry.collectionUrl });
      add({ brand: entry.vendor, axis: 'ブランド名＋正規取扱', query: alias + ' 正規取扱',
        queryVariant: alias, collectionUrl: entry.collectionUrl });
      categories.forEach(function (category) {
        add({ brand: entry.vendor, axis: 'ブランド名＋カテゴリー',
          query: alias + ' ' + category, queryVariant: alias, category: category,
          collectionUrl: entry.collectionUrl });
      });
    });
    (byVendor[entry.vendor] || []).forEach(function (product) {
      const productTitle = String(product.title || '').trim();
      const productCode = String(product.productCode && product.productCode.value || '').trim();
      if (productTitle) add({ brand: entry.vendor, axis: 'ブランド名＋商品名',
        query: entry.vendor + ' ' + productTitle, queryVariant: entry.vendor,
        productHandle: product.handle || '', productTitle: productTitle,
        collectionUrl: entry.collectionUrl });
      if (productCode) add({ brand: entry.vendor, axis: 'ブランド名＋商品コード／品番',
        query: entry.vendor + ' ' + productCode, queryVariant: entry.vendor,
        productHandle: product.handle || '', productTitle: productTitle,
        productCode: productCode, collectionUrl: entry.collectionUrl });
    });
    const reference = KEA_BRAND_QUERY_REFERENCES_[entry.vendor] || {};
    const companies = reference.companies || [];
    companies.forEach(function (company) {
      add({ brand: entry.vendor, axis: 'ブランド会社名・運営会社名',
        query: company, queryVariant: [reference.source, reference.note || ''].join(' ').trim(),
        collectionUrl: entry.collectionUrl });
    });
    if (!companies.length) add({ brand: entry.vendor, axis: 'ブランド会社名・運営会社名',
      query: '', queryVariant: '未登録（根拠確認待ち）',
      collectionUrl: entry.collectionUrl, unavailable: true });
  });
  return rows;
}

function brandRankMetric_(gscRows, query, collectionUrl) {
  const normalized = brandRankNormalizeQuery_(query);
  const perPage = {};
  (gscRows || []).forEach(function (row) {
    const keys = row.keys || [];
    if (brandRankNormalizeQuery_(keys[0]) !== normalized) return;
    const page = String(keys[1] || '');
    if (!page) return;
    if (!perPage[page]) {
      perPage[page] = { page: page, clicks: 0, impressions: 0, weightedPosition: 0 };
    }
    const target = perPage[page];
    const impressions = Number(row.impressions || 0);
    target.clicks += Number(row.clicks || 0);
    target.impressions += impressions;
    target.weightedPosition += Number(row.position || 0) * impressions;
  });
  const pages = Object.keys(perPage).map(function (key) {
    const row = perPage[key];
    row.ctr = row.impressions ? row.clicks / row.impressions : 0;
    row.position = row.impressions ? row.weightedPosition / row.impressions : 0;
    return row;
  }).sort(function (left, right) {
    return right.impressions - left.impressions || right.clicks - left.clicks ||
      left.position - right.position;
  });
  const total = pages.reduce(function (result, row) {
    result.clicks += row.clicks;
    result.impressions += row.impressions;
    result.weightedPosition += row.weightedPosition;
    return result;
  }, { clicks: 0, impressions: 0, weightedPosition: 0 });
  total.ctr = total.impressions ? total.clicks / total.impressions : 0;
  total.position = total.impressions ? total.weightedPosition / total.impressions : 0;
  const collection = perPage[String(collectionUrl || '')] ||
    { page: String(collectionUrl || ''), clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: total.clicks, impressions: total.impressions, ctr: total.ctr,
    position: total.position, selectedPage: pages.length ? pages[0].page : '',
    collection: collection,
  };
}

function brandRankEnsureSheet_(name, headers) {
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const existing = sheet.getRange(1, 1, 1, Math.max(1, headers.length)).getValues()[0];
  if (existing.join('|') !== headers.join('|')) {
    // Add the inventory column without erasing the existing 24-column history.
    const summaryExtension = name === KEA_BRAND_RANK_SUMMARY_SHEET_ &&
      existing.slice(0, 24).join('|') === headers.slice(0, 24).join('|') &&
      !existing[24];
    if (!summaryExtension) sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#111111').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Pure aggregation of the existing weekly collection-ranking observations. */
function brandRankKpiFromRows_(rows) {
  const candidates = (rows || []).filter(function (row) {
    return row.window === 'last_28d' && row.checkedAt;
  });
  const latest = candidates.reduce(function (time, row) {
    return Math.max(time, new Date(row.checkedAt).getTime() || 0);
  }, 0);
  const current = candidates.filter(function (row) {
    return new Date(row.checkedAt).getTime() === latest;
  });
  const byBrand = {};
  current.forEach(function (row) { byBrand[row.brand] = row; });
  // The latest catalog-backed run defines active brands, not the alias reference.
  const brands = Object.keys(byBrand);
  const items = brands.map(function (brand) {
    const row = byBrand[brand] || {};
    const impressions = Number(row.collectionImpressions || 0);
    const position = Number(row.collectionPosition || 0);
    const observed = impressions > 0 && isFinite(position) && position > 0;
    return {
      brand: brand, query: row.brandQuery || '', collectionUrl: row.collectionUrl || '',
      clicks: Number(row.collectionClicks || 0), impressions: impressions,
      ctr: Number(row.collectionCtr || 0), position: observed ? position : null,
      status: !observed ? 'unknown' : position <= 10 ? 'TOP10' : position <= 20 ? '11–20' : '21以下',
      lowSample: observed && impressions <= 2,
      inStockProductCount: row.inStockProductCount === '' || row.inStockProductCount == null
        ? null : Number(row.inStockProductCount),
    };
  });
  const count = function (status) {
    return items.filter(function (item) { return item.status === status; }).length;
  };
  const first = current[0] || {};
  const dateText = function (value) {
    return value instanceof Date ? dateKey_(value) : String(value || '');
  };
  return {
    available: !!current.length,
    checkedAt: first.checkedAt instanceof Date ? first.checkedAt.toISOString() : first.checkedAt || '',
    windowStart: dateText(first.windowStart), windowEnd: dateText(first.windowEnd),
    brandCount: items.length, top10Count: count('TOP10'),
    top10Rate: items.length ? count('TOP10') / items.length : null,
    nearTop10Count: count('11–20'), lowerRankCount: count('21以下'), unknownCount: count('unknown'),
    lowSampleTop10: items.filter(function (item) { return item.status === 'TOP10' && item.lowSample; }),
    gscRowsComplete: current.length > 0 && current.every(function (row) {
      return row.gscRowsComplete === true || row.gscRowsComplete === 'TRUE';
    }),
    definition: '英字・日本語等の単体表記のうち、対象ブランドコレクションの平均順位が最良の表記（同順位は表示数順）を採用。商品・旧URLの順位は成功に含めない。',
    caveat: 'GSC無観測はunknownで、TOP10外や表示ゼロとは断定しない。1〜2表示は暫定。平均順位は実際の全検索での固定順位ではない。各表記はBrandSEOQueriesを参照。',
    brands: items,
  };
}

/** Read saved observations only; daily/dashboard never trigger another collector. */
function readBrandRankKpi_() {
  try {
    const sheet = getDashboardSpreadsheet_().getSheetByName(KEA_BRAND_RANK_SUMMARY_SHEET_);
    if (!sheet) return brandRankKpiFromRows_([]);
    const values = sheet.getDataRange().getValues();
    const headers = values.shift() || [];
    return brandRankKpiFromRows_(values.map(function (row) { return rowObject_(headers, row); }));
  } catch (error) {
    return { available: false, reason: '保存済みブランド順位を取得できません: ' + error.message };
  }
}

function buildBrandRankKpiSummary_() {
  const kpi = readBrandRankKpi_();
  if (!kpi.available) return 'SEO主要KPI｜ブランド名単体TOP10率: 未取得' +
    (kpi.reason ? '（' + kpi.reason + '）' : '（既存週次監視の取得待ち）') + '\n\n';
  const lowSample = kpi.lowSampleTop10.map(function (item) {
    return item.brand + '「' + item.query + '」' + item.impressions + '表示';
  }).join(' / ');
  return [
    'SEO主要KPI｜ブランド名単体でブランドページTOP10',
    '- ' + kpi.top10Count + '/' + kpi.brandCount + 'ブランド（' +
      (kpi.top10Rate * 100).toFixed(1) + '%、全対象が分母） / 11〜20位: ' +
      kpi.nearTop10Count + ' / 21位以下: ' + kpi.lowerRankCount + ' / unknown: ' + kpi.unknownCount,
    '- TOP10のうち少量で暫定: ' + (lowSample || 'なし'),
    '- 既存週次取得値: ' + kpi.windowStart + '〜' + kpi.windowEnd + ' / 最終取得 ' + kpi.checkedAt,
    '- 定義: ' + kpi.definition,
    '- 注意: ' + kpi.caveat + (kpi.gscRowsComplete ? '' : ' GSC取得上限到達または完全性未確認。'),
    '- カテゴリー掛け合わせは補助指標。SEO変更の効果は再クロール後の期間で比較する。',
    '', '',
  ].join('\n');
}

function brandRankReplaceRows_(sheetName, headers, rows) {
  const sheet = brandRankEnsureSheet_(sheetName, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, Math.min(headers.length, 10));
}

function brandRankAppendRows_(sheetName, headers, rows) {
  const sheet = brandRankEnsureSheet_(sheetName, headers);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  const excess = sheet.getLastRow() - 1001;
  if (excess > 0) sheet.deleteRows(2, excess);
}

function brandRankAcquireLease_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return '';
  try {
    const properties = PropertiesService.getScriptProperties();
    const current = Number(String(properties.getProperty(KEA_BRAND_RANK_LEASE_KEY_) || '0').split('|')[0]);
    const now = Date.now();
    if (current > now) return '';
    const token = String(now) + '-' + Utilities.getUuid();
    properties.setProperty(KEA_BRAND_RANK_LEASE_KEY_, String(now + 10 * 60 * 1000) + '|' + token);
    return token;
  } finally {
    lock.releaseLock();
  }
}

function brandRankReleaseLease_(token) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const stored = String(properties.getProperty(KEA_BRAND_RANK_LEASE_KEY_) || '');
    if (stored.indexOf('|' + token) >= 0) properties.deleteProperty(KEA_BRAND_RANK_LEASE_KEY_);
  } finally {
    lock.releaseLock();
  }
}

function brandRankOldEcChecks_() {
  return Object.keys(KEA_OLD_EC_REDIRECT_TARGETS || {}).map(function (url) {
    const http = inspectHttpUrl_(url);
    const expected = KEA_OLD_EC_REDIRECT_TARGETS[url];
    return { url: url, status: http.status, location: http.location, expected: expected,
      oneToOne: (http.status === 301 || http.status === 308) && http.location === expected };
  });
}

function brandRankEntryTech_(config, entry, oldEcByTarget) {
  const deep = brandSeoDeepResult_(config, entry, [], []);
  const title = String(entry.collection && entry.collection.seo && entry.collection.seo.title || '');
  const description = String(entry.collection && entry.collection.seo && entry.collection.seo.description || '');
  const body = String(entry.collection && entry.collection.descriptionHtml || '');
  const oldEc = oldEcByTarget[entry.collectionUrl] || {};
  return [
    isoTimestamp_(new Date()), entry.vendor, entry.collectionUrl, entry.productCount,
    deep.indexed, deep.verdict || '', deep.coverageState || '', deep.indexingState || '',
    deep.robotsTxtState || '', deep.lastCrawlTime || '', deep.googleCanonical || '',
    deep.shopifyCanonical || '', deep.canonicalMatches, deep.httpStatus || '',
    deep.finalHttpStatus || '', deep.redirectLocation || '', title, !!description,
    !!body, !!(entry.found && entry.found.hasExpectedVendorRule), oldEc.url || '',
    oldEc.status || '', oldEc.location || '', oldEc.expected || '',
    oldEc.oneToOne === undefined ? '' : oldEc.oneToOne,
  ];
}

function brandRankRun_(manual) {
  const token = brandRankAcquireLease_();
  if (!token) return { status: 'skipped', reason: 'brand rank monitor already active' };
  try {
    const config = keaConfig_();
    const catalog = collectShopifyCatalog_(config);
    if (!catalog.available) throw new Error(catalog.reason || 'Shopify catalog unavailable');
    const vendorRows = brandSeoActiveVendorRows_(catalog.products);
    const inStockByVendor = {};
    (catalog.products || []).forEach(function (product) {
      if (product.status === 'ACTIVE' && product.publishedAt && product.onlineStoreUrl &&
          Number(product.totalInventory) > 0) {
        inStockByVendor[product.vendor] = (inStockByVendor[product.vendor] || 0) + 1;
      }
    });
    const collections = collectBrandSeoCollections_(config);
    const entries = vendorRows.map(function (row) { return brandSeoConfiguration_(row, collections); });
    const products = brandRankProductCatalog_(config);
    const targets = brandRankTargetRows_(entries, products);
    const windows = brandRankCurrentWindows_();
    const gsc = {};
    windows.forEach(function (window) {
      gsc[window.key] = brandRankSearchConsoleQueryPageRows_(config, window.start, window.end);
    });
    const checkedAt = isoTimestamp_(new Date());
    const queryRows = [];
    const summaryRows = [];
    windows.forEach(function (window) {
      const data = gsc[window.key];
      targets.forEach(function (target) {
        const metric = target.unavailable
          ? { clicks: 0, impressions: 0, ctr: 0, position: 0, selectedPage: '', collection: {} }
          : brandRankMetric_(data.rows, target.query, target.collectionUrl);
        queryRows.push([
          checkedAt, window.key, dateKey_(window.start), dateKey_(window.end), target.brand,
          target.axis, target.query || '', target.queryVariant || '', target.category || '',
          target.productHandle || '', target.productTitle || '', target.productCode || '',
          metric.clicks, metric.impressions, metric.ctr, metric.impressions ? metric.position : '', metric.selectedPage || '',
          target.collectionUrl || '', metric.collection.clicks || 0,
          metric.collection.impressions || 0, metric.collection.ctr || 0,
          metric.collection.position || 0, data.complete, !target.unavailable,
        ]);
      });
      entries.forEach(function (entry) {
        const brandMetrics = targets.filter(function (target) {
          return target.brand === entry.vendor && target.axis === 'ブランド名単体';
        }).map(function (target) {
          return { target: target, metric: brandRankMetric_(data.rows, target.query, entry.collectionUrl) };
        }).sort(function (left, right) {
          const lp = Number(left.metric.collection.position || 0) || 9999;
          const rp = Number(right.metric.collection.position || 0) || 9999;
          return lp - rp || right.metric.collection.impressions - left.metric.collection.impressions;
        });
        const best = brandMetrics[0] || { target: {}, metric: { collection: {} } };
        const collectionMetric = best.metric.collection || {};
        const aliases = brandRankAliases_(entry);
        const top10 = Number(collectionMetric.impressions || 0) > 0 &&
          Number(collectionMetric.position || 0) > 0 && Number(collectionMetric.position || 0) <= 10;
        summaryRows.push([
          checkedAt, window.key, dateKey_(window.start), dateKey_(window.end), entry.vendor,
          entry.vendor, brandRankJapaneseAliases_(aliases).join(' / '), aliases.join(' / '),
          entry.collectionUrl, entry.productCount, best.target.query || '',
          best.metric.clicks || 0, best.metric.impressions || 0, best.metric.ctr || 0,
          best.metric.position || 0, best.metric.selectedPage || '', entry.collectionUrl,
          collectionMetric.clicks || 0, collectionMetric.impressions || 0,
          collectionMetric.ctr || 0, collectionMetric.position || 0, top10,
          data.complete, (data.complete ? '' : 'Search Console rowLimit 25,000に到達。') +
            '取得行なしはunknown（匿名化・少量クエリ除外あり）。対象期間を確認し、SEO変更の効果は再クロール後の期間で比較する。',
          inStockByVendor[entry.vendor] || 0,
        ]);
      });
    });
    const oldEcByTarget = {};
    brandRankOldEcChecks_().forEach(function (row) { oldEcByTarget[row.expected] = row; });
    const techRows = entries.map(function (entry) {
      return brandRankEntryTech_(config, entry, oldEcByTarget);
    });
    brandRankReplaceRows_(KEA_BRAND_RANK_QUERY_SHEET_, KEA_BRAND_RANK_QUERY_HEADERS_, queryRows);
    brandRankReplaceRows_(KEA_BRAND_RANK_TECH_SHEET_, KEA_BRAND_RANK_TECH_HEADERS_, techRows);
    brandRankAppendRows_(KEA_BRAND_RANK_SUMMARY_SHEET_, KEA_BRAND_RANK_SUMMARY_HEADERS_, summaryRows);
    const current = summaryRows.filter(function (row) { return row[1] === 'last_28d'; });
    const top10Count = current.filter(function (row) { return row[21] === true; }).length;
    return {
      status: 'passed', manual: !!manual, checkedAt: checkedAt, brandCount: entries.length,
      top10Count: top10Count, targetCount: targets.length, productCount: products.length,
      gscRows: Object.keys(gsc).reduce(function (result, key) {
        result[key] = { rows: gsc[key].rows.length, complete: gsc[key].complete };
        return result;
      }, {}),
    };
  } finally {
    brandRankReleaseLease_(token);
  }
}

function runBrandNameRankMonitor() {
  return brandRankRun_(false);
}

function runBrandNameRankMonitorNow() {
  const result = brandRankRun_(true);
  Logger.log(JSON.stringify(result));
  return result;
}

function ensureBrandNameRankMonitorTrigger() {
  ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === KEA_BRAND_RANK_TRIGGER_HANDLER_;
  }).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(KEA_BRAND_RANK_TRIGGER_HANDLER_)
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  return { status: 'installed', handler: KEA_BRAND_RANK_TRIGGER_HANDLER_ };
}
