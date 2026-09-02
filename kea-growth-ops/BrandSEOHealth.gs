/**
 * ブランドSEOは、公開中（ACTIVEかつOnline Store掲載）の商品Vendorを唯一の正とします。
 * Vendor表記は正規化・統合せず、Shopifyの商品データにある表記をそのまま扱います。
 */
const KEA_BRAND_SEO_ORIGIN = 'https://store.kea.co.jp';
const KEA_BRAND_SEO_WEEKLY_STATE_KEY = 'KEA_BRAND_SEO_WEEKLY_STATE_V1';
const KEA_BRAND_SEO_EXCLUDED_VENDOR_NAMES = Object.freeze([
  'test',
  'dummy',
  'sample',
  'テスト',
  'ダミー',
  'サンプル',
]);
const KEA_BRAND_SEO_COLLECTION_HANDLE_BY_VENDOR = Object.freeze({
  'Agapantha Jewelry': 'agapantha',
  'Button Works': 'buttonworks',
  "LEVI'S": 'levis',
  'kit・sch': 'kitsch',
});

function brandSeoText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function brandSeoExcludedVendor_(vendor) {
  const value = brandSeoText_(vendor).toLowerCase();
  return KEA_BRAND_SEO_EXCLUDED_VENDOR_NAMES.indexOf(value) >= 0;
}

function brandSeoSuggestedHandle_(vendor) {
  const source = brandSeoText_(vendor);
  if (!source) return '';
  const verifiedHandle = KEA_BRAND_SEO_COLLECTION_HANDLE_BY_VENDOR[source];
  if (verifiedHandle) return verifiedHandle;
  const normalized = typeof source.normalize === 'function'
    ? source.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    : source;
  const handle = normalized
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return handle;
}

function brandSeoPlainText_(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function brandSeoCollectionUrl_(handle) {
  const safeHandle = brandSeoText_(handle);
  return safeHandle ? KEA_BRAND_SEO_ORIGIN + '/collections/' + safeHandle : '';
}

function collectBrandSeoCollections_(config) {
  let after = null;
  const collections = [];
  do {
    const data = shopifyGraphql_(
      config,
      'query KeaBrandSeoCollections($after: String) {' +
        ' collections(first: 250, after: $after, sortKey: UPDATED_AT) {' +
        '  nodes {' +
        '   id title handle descriptionHtml' +
        '   seo { title description }' +
        '   ruleSet { rules { column relation condition } }' +
        '  }' +
        '  pageInfo { hasNextPage endCursor }' +
        ' }' +
        '}',
      { after: after },
      'Shopify brand SEO collections',
    );
    const connection = data.collections || { nodes: [], pageInfo: {} };
    collections.push.apply(collections, connection.nodes || []);
    after = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);
  return collections;
}

function brandSeoVendorConditionMatches_(collection, vendor) {
  const rules = collection && collection.ruleSet && collection.ruleSet.rules || [];
  return rules.some(function (rule) {
    return String(rule && rule.column || '') === 'VENDOR' &&
      String(rule && rule.condition || '') === String(vendor);
  });
}

function brandSeoFindCollection_(vendor, suggestedHandle, collections) {
  const vendorCollections = collections.filter(function (collection) {
    return brandSeoVendorConditionMatches_(collection, vendor);
  });
  const handleCollection = suggestedHandle
    ? collections.filter(function (collection) {
        return String(collection.handle || '') === suggestedHandle;
      })[0] || null
    : null;
  const candidates = vendorCollections.slice();
  if (
    handleCollection &&
    !candidates.some(function (collection) {
      return collection.id === handleCollection.id;
    })
  ) {
    candidates.push(handleCollection);
  }
  return {
    collection: vendorCollections[0] || handleCollection || null,
    vendorCollectionCount: vendorCollections.length,
    candidateCount: candidates.length,
    hasExpectedVendorRule: !!vendorCollections.length,
    hasExpectedHandle: !!(
      (vendorCollections[0] || handleCollection) &&
      suggestedHandle &&
      String((vendorCollections[0] || handleCollection).handle || '') ===
        suggestedHandle
    ),
  };
}

function brandSeoActiveVendorRows_(products) {
  const byVendor = {};
  (products || []).forEach(function (product) {
    const vendor = String(product && product.vendor || '');
    if (
      !vendor ||
      product.status !== 'ACTIVE' ||
      !product.publishedAt ||
      !product.onlineStoreUrl ||
      brandSeoExcludedVendor_(vendor)
    ) {
      return;
    }
    if (!byVendor[vendor]) {
      byVendor[vendor] = {
        vendor: vendor,
        productCount: 0,
        productHandles: [],
      };
    }
    byVendor[vendor].productCount += 1;
    if (product.handle) byVendor[vendor].productHandles.push(product.handle);
  });
  return Object.keys(byVendor).map(function (vendor) {
    return byVendor[vendor];
  }).sort(function (left, right) {
    return left.vendor.localeCompare(right.vendor);
  });
}

function brandSeoTitleCandidate_(vendor) {
  return vendor + ' 通販・正規取扱店｜名古屋・大須 Kea.';
}

function brandSeoMetaCandidate_(vendor) {
  return vendor +
    'の正規取扱店、名古屋・大須のセレクトショップKea.。Kea.がセレクトした' +
    vendor +
    'の商品を、店舗と公式オンラインストアでご覧いただけます。';
}

function brandSeoBodyCandidate_(vendor) {
  return 'Kea.では' + vendor +
    'を名古屋・大須の実店舗と公式オンラインストアで取り扱っています。' +
    'Kea.がセレクトした' + vendor +
    'の商品をご覧いただけます。新作の入荷・予約情報は、掲載中の各商品ページでご案内します。';
}

function brandSeoConfiguration_(vendorRow, collections) {
  const suggestedHandle = brandSeoSuggestedHandle_(vendorRow.vendor);
  const found = brandSeoFindCollection_(
    vendorRow.vendor,
    suggestedHandle,
    collections,
  );
  const collection = found.collection;
  const title = collection && collection.seo && collection.seo.title || '';
  const description = collection && collection.seo &&
    collection.seo.description || '';
  const body = collection ? brandSeoPlainText_(collection.descriptionHtml) : '';
  const issues = [];
  if (!collection) {
    issues.push('ブランドCollectionなし');
  } else {
    if (found.candidateCount > 1 || found.vendorCollectionCount > 1) {
      issues.push('重複候補あり');
    }
    if (!found.hasExpectedVendorRule) {
      issues.push('Vendor条件未確認');
    }
    if (!found.hasExpectedHandle) {
      issues.push('handle要確認');
    }
    if (!brandSeoText_(title)) issues.push('SEO Title未設定');
    if (!brandSeoText_(description)) issues.push('Meta Description未設定');
    if (!body) issues.push('Collection本文未設定');
  }
  return {
    vendor: vendorRow.vendor,
    productCount: vendorRow.productCount,
    productHandles: vendorRow.productHandles,
    suggestedHandle: suggestedHandle,
    collection: collection,
    collectionUrl: collection
      ? brandSeoCollectionUrl_(collection.handle)
      : brandSeoCollectionUrl_(suggestedHandle),
    issues: issues,
    found: found,
    titleCandidate: brandSeoTitleCandidate_(vendorRow.vendor),
    metaCandidate: brandSeoMetaCandidate_(vendorRow.vendor),
    bodyCandidate: brandSeoBodyCandidate_(vendorRow.vendor),
  };
}

function brandSeoWeekKey_(date) {
  return Utilities.formatDate(
    date || new Date(),
    KEA_DEFAULTS.TIME_ZONE,
    'YYYY-ww',
  );
}

function brandSeoDeepCheckRequired_(force) {
  const state = healthReadJsonProperty_(KEA_BRAND_SEO_WEEKLY_STATE_KEY, {});
  return force === true || state.weekKey !== brandSeoWeekKey_(new Date());
}

function brandSeoQueryRows_(queryRows, vendor) {
  const needle = String(vendor || '').toLowerCase();
  if (!needle) return [];
  return (queryRows || []).filter(function (row) {
    return String(row && row.keys && row.keys[0] || '')
      .toLowerCase()
      .indexOf(needle) >= 0;
  });
}

function brandSeoPageRow_(pageRows, url) {
  return (pageRows || []).filter(function (row) {
    return String(row && row.keys && row.keys[0] || '') === String(url);
  })[0] || null;
}

function brandSeoMetric_(pageRows, queryRows, entry) {
  const page = brandSeoPageRow_(pageRows, entry.collectionUrl);
  const queries = brandSeoQueryRows_(queryRows, entry.vendor);
  const queryNames = queries.slice(0, 6).map(function (row) {
    return String(row.keys && row.keys[0] || '');
  });
  return {
    impressions: page ? Number(page.impressions || 0) : 0,
    clicks: page ? Number(page.clicks || 0) : 0,
    ctr: page ? Number(page.ctr || 0) : 0,
    position: page ? Number(page.position || 0) : 0,
    queries: queryNames,
  };
}

function brandSeoDeepResult_(config, entry, pageRows, queryRows) {
  const metric = brandSeoMetric_(pageRows, queryRows, entry);
  if (!entry.collection || !entry.collectionUrl) {
    return {
      url: entry.collectionUrl || '',
      indexed: null,
      canonicalMatches: null,
      finalHttpStatus: null,
      metric: metric,
      error: 'ブランドCollection未設定',
    };
  }
  try {
    const result = seoMajorUrlResult_(config, entry.collectionUrl);
    result.metric = metric;
    return result;
  } catch (error) {
    return {
      url: entry.collectionUrl,
      indexed: null,
      canonicalMatches: null,
      finalHttpStatus: null,
      metric: metric,
      error: String(error && error.message || error),
    };
  }
}

function brandSeoRecommendation_(entry, deep) {
  const isNewSetup = !entry.collection;
  const category = isNewSetup
    ? '新ブランドSEO設定候補'
    : 'ブランドSEO設定候補';
  const target = entry.collectionUrl || entry.vendor;
  const evidence = [
    'ブランド: ' + entry.vendor,
    '公開商品数: ' + entry.productCount,
    'Collection: ' + (entry.collection ? entry.collectionUrl : 'なし'),
    '問題: ' + entry.issues.join(' / '),
    '旧ECブランドページ: 未照合',
    '301候補: 未照合',
  ];
  if (deep && deep.metric) {
    evidence.push(
      '表示: ' + deep.metric.impressions +
        ' / クリック: ' + deep.metric.clicks +
        ' / CTR: ' + percent_(deep.metric.ctr) +
        ' / 順位: ' + decimal_(deep.metric.position),
    );
    if (deep.metric.queries.length) {
      evidence.push('クエリ: ' + deep.metric.queries.join(' / '));
    }
  }
  return healthRecommendation_(
    'SEO',
    'brand-setup|' + entry.vendor,
    category,
    isNewSetup ? '中' : '高',
    target,
    evidence.join('\n'),
    [
      '推奨handle: ' + (entry.suggestedHandle || '要確認'),
      'Title案: ' + entry.titleCandidate,
      'Meta案: ' + entry.metaCandidate,
      '本文案: ' + entry.bodyCandidate,
      'Vendor表記・公式表記・旧EC対応を確認後、承認時のみCollection、導線、301を設定します。',
    ].join('\n'),
  );
}

function brandSeoOperationalRecommendation_(entry, deep) {
  if (!deep || !entry.collection) return null;
  const metric = deep.metric || {};
  if (deep.indexed === false) {
    return healthRecommendation_(
      'SEO',
      'brand-index|' + entry.vendor + '|' + entry.collectionUrl,
      'ブランドSEO監視',
      '高',
      entry.collectionUrl,
      [
        'ブランド: ' + entry.vendor,
        'クエリ: ' + (metric.queries.join(' / ') || entry.vendor),
        'ページ: ' + entry.collectionUrl,
        '表示: ' + metric.impressions,
        'CTR: ' + percent_(metric.ctr),
        '順位: ' + decimal_(metric.position),
        '原因: ' + (deep.coverageState || deep.verdict || 'Google未登録'),
      ].join('\n'),
      'Search ConsoleのURL検査で原因を確認し、最重要ブランドに限り1回だけインデックス登録を申請します。',
    );
  }
  if (deep.canonicalMatches === false || Number(deep.finalHttpStatus || 0) >= 400) {
    return healthRecommendation_(
      'SEO',
      'brand-url|' + entry.vendor + '|' + entry.collectionUrl,
      'ブランドSEO監視',
      '高',
      entry.collectionUrl,
      [
        'ブランド: ' + entry.vendor,
        'クエリ: ' + (metric.queries.join(' / ') || entry.vendor),
        'ページ: ' + entry.collectionUrl,
        'HTTP: ' + (deep.finalHttpStatus || '取得不可'),
        'canonical: Google ' + (deep.googleCanonical || '未取得') +
          ' / Shopify ' + (deep.shopifyCanonical || '未取得'),
      ].join('\n'),
      'Collection URL、canonical、内部リンク、旧URLの301を確認します。',
    );
  }
  if (
    Number(metric.impressions || 0) >= 100 &&
    Number(metric.ctr || 0) < 0.02 &&
    Number(metric.position || 0) > 0 &&
    Number(metric.position || 0) <= 20
  ) {
    return healthRecommendation_(
      'SEO',
      'brand-ctr|' + entry.vendor + '|' + entry.collectionUrl,
      'ブランドSEO監視',
      '中',
      entry.collectionUrl,
      [
        'ブランド: ' + entry.vendor,
        'クエリ: ' + (metric.queries.join(' / ') || entry.vendor),
        'ページ: ' + entry.collectionUrl,
        '表示: ' + metric.impressions,
        'CTR: ' + percent_(metric.ctr),
        '順位: ' + decimal_(metric.position),
        '原因: 十分な表示があり、検索結果での訴求改善余地あり',
      ].join('\n'),
      '複数週で継続する場合のみ、Title・Meta Description・内部リンクの改善案を検討します。',
    );
  }
  return null;
}

function brandSeoStateIssue_(previous, current) {
  if (!previous) return null;
  if (previous.indexed === true && current.indexed === false) {
    return {
      key: 'SEO|brand-index-lost|' + current.vendor,
      text: 'ブランドCollectionがGoogle未登録へ変化: ' + current.vendor,
    };
  }
  if (current.finalHttpStatus && Number(current.finalHttpStatus) >= 400 &&
      Number(previous.finalHttpStatus || 0) < 400) {
    return {
      key: 'SEO|brand-http|' + current.vendor + '|' + current.finalHttpStatus,
      text: 'ブランドCollectionのHTTP異常: ' + current.vendor +
        ' (' + current.finalHttpStatus + ')',
    };
  }
  if (previous.canonicalMatches !== false && current.canonicalMatches === false) {
    return {
      key: 'SEO|brand-canonical|' + current.vendor,
      text: 'ブランドCollectionのcanonical不一致: ' + current.vendor,
    };
  }
  return null;
}

/**
 * 毎日、公開VendorとCollection設定を照合し、新VendorはRecommendationsへ回します。
 * Search Console URL検査・順位は週1回だけ実行します。
 */
function runBrandSeoHealthAudit_(config, audit, options) {
  const catalog = collectShopifyCatalog_(config);
  if (!catalog.available) {
    return {
      available: false,
      reason: catalog.reason || 'Shopify catalogを取得できませんでした。',
      entries: [],
      recommendations: [],
      notificationIssues: [],
      summary: { brandCount: 0, setupCandidates: 0 },
    };
  }
  const vendors = brandSeoActiveVendorRows_(catalog.products);
  const collections = collectBrandSeoCollections_(config);
  const entries = vendors.map(function (vendorRow) {
    return brandSeoConfiguration_(vendorRow, collections);
  });
  const deepCheck = brandSeoDeepCheckRequired_(options && options.force);
  const previous = healthReadJsonProperty_(KEA_BRAND_SEO_WEEKLY_STATE_KEY, {});
  const nextEntries = {};
  const recommendations = [];
  const notificationIssues = [];

  entries.forEach(function (entry) {
    let deep = null;
    if (deepCheck) {
      deep = brandSeoDeepResult_(
        config,
        entry,
        audit && audit.pageRows || [],
        audit && audit.queryRows || [],
      );
      nextEntries[entry.vendor] = {
        vendor: entry.vendor,
        collectionUrl: entry.collectionUrl,
        indexed: deep.indexed,
        canonicalMatches: deep.canonicalMatches,
        finalHttpStatus: deep.finalHttpStatus,
      };
      const stateIssue = brandSeoStateIssue_(
        previous.entries && previous.entries[entry.vendor],
        nextEntries[entry.vendor],
      );
      if (stateIssue) notificationIssues.push(stateIssue);
    }
    if (entry.issues.length) {
      recommendations.push(brandSeoRecommendation_(entry, deep));
    }
    const operational = brandSeoOperationalRecommendation_(entry, deep);
    if (operational) recommendations.push(operational);
  });

  if (deepCheck) {
    healthWriteJsonProperty_(KEA_BRAND_SEO_WEEKLY_STATE_KEY, {
      weekKey: brandSeoWeekKey_(new Date()),
      checkedAt: isoTimestamp_(new Date()),
      entries: nextEntries,
    });
  }

  return {
    available: true,
    entries: entries,
    recommendations: recommendations,
    notificationIssues: notificationIssues,
    summary: {
      brandCount: entries.length,
      setupCandidates: entries.filter(function (entry) {
        return !entry.collection;
      }).length,
      issueCount: entries.filter(function (entry) {
        return entry.issues.length;
      }).length,
      deepCheck: deepCheck,
    },
  };
}

function runBrandSeoHealthAuditNow() {
  return withScriptLock_('runBrandSeoHealthAuditNow', function () {
    ensureHealthSheets_();
    const config = keaConfig_();
    const audit = {
      queryRows: searchConsoleAnalytics_(
        config, dateDaysAgo_(9), dateDaysAgo_(3), ['query'], 25000,
      ),
      pageRows: searchConsoleAnalytics_(
        config, dateDaysAgo_(9), dateDaysAgo_(3), ['page'], 25000,
      ),
    };
    return runBrandSeoHealthAudit_(config, audit, { force: true });
  });
}
