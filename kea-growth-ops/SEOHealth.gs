const KEA_SEO_MAJOR_URLS = [
  'https://store.kea.co.jp/',
  'https://store.kea.co.jp/collections/all',
  'https://store.kea.co.jp/collections/new-arrival',
];

const KEA_OLD_EC_URLS = [
  'https://www.kea.co.jp/store/',
  'https://www.kea.co.jp/store/products/',
  'https://www.kea.co.jp/store/products/list.php',
];

function searchConsoleAnalytics_(
  config,
  startDate,
  endDate,
  dimensions,
  rowLimit,
) {
  const siteUrl = String(config.SEARCH_CONSOLE_SITE_URL || '').trim();
  if (!siteUrl) throw new Error('SEARCH_CONSOLE_SITE_URL未設定');
  const payload = {
    startDate: dateKey_(startDate),
    endDate: dateKey_(endDate),
    rowLimit: rowLimit || 25000,
    dataState: 'final',
  };
  if (dimensions && dimensions.length) payload.dimensions = dimensions;
  const response = googleJson_(
    'https://www.googleapis.com/webmasters/v3/sites/' +
      encodeURIComponent(siteUrl) + '/searchAnalytics/query',
    { method: 'post', payload: payload },
    'Search Console health analytics',
  );
  return (response.rows || []).map(function (row) {
    return {
      keys: row.keys || [],
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0),
    };
  });
}

function seoSummaryFromRows_(rows) {
  if (!rows || !rows.length) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }
  const totals = rows.reduce(function (result, row) {
    result.clicks += Number(row.clicks || 0);
    result.impressions += Number(row.impressions || 0);
    result.positionWeighted +=
      Number(row.position || 0) * Number(row.impressions || 0);
    return result;
  }, { clicks: 0, impressions: 0, positionWeighted: 0 });
  return {
    clicks: totals.clicks,
    impressions: totals.impressions,
    ctr: safeDivide_(totals.clicks, totals.impressions),
    position: safeDivide_(totals.positionWeighted, totals.impressions),
  };
}

function healthAttempt_(label, callback, fallback) {
  try {
    return { available: true, value: callback(), error: '' };
  } catch (error) {
    return {
      available: false,
      value: fallback,
      error: label + ': ' + String(error && error.message || error),
    };
  }
}

function collectSearchConsoleSitemaps_(config) {
  const siteUrl = String(config.SEARCH_CONSOLE_SITE_URL || '').trim();
  if (!siteUrl) throw new Error('SEARCH_CONSOLE_SITE_URL未設定');
  const response = googleJson_(
    'https://www.googleapis.com/webmasters/v3/sites/' +
      encodeURIComponent(siteUrl) + '/sitemaps',
    { method: 'get' },
    'Search Console sitemaps.list',
  );
  const rows = response.sitemap || [];
  return {
    rows: rows,
    errors: rows.reduce(function (sum, item) {
      return sum + Number(item.errors || 0);
    }, 0),
    warnings: rows.reduce(function (sum, item) {
      return sum + Number(item.warnings || 0);
    }, 0),
    pending: rows.filter(function (item) {
      return item.isPending === true;
    }).length,
  };
}

function collectRepresentativeShopifyUrl_(config) {
  const data = shopifyGraphql_(
    config,
    'query KeaSeoRepresentativeProduct {' +
      ' products(first: 20, query: "status:active", sortKey: UPDATED_AT, reverse: true) {' +
      '  nodes { handle status publishedAt onlineStoreUrl }' +
      ' }' +
      '}',
    {},
    'Shopify representative public product',
  );
  const product = ((data.products && data.products.nodes) || []).find(
    function (item) {
      return item.status === 'ACTIVE' && item.publishedAt && item.onlineStoreUrl;
    },
  );
  if (!product) throw new Error('公開中の商品URLを取得できませんでした。');
  return product.onlineStoreUrl;
}

function absoluteRedirectUrl_(sourceUrl, location) {
  const value = String(location || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const origin = String(sourceUrl).match(/^(https?:\/\/[^/]+)/i);
  if (!origin) return value;
  return value.charAt(0) === '/'
    ? origin[1] + value
    : origin[1] + '/' + value;
}

function canonicalFromHtml_(html) {
  const source = String(html || '');
  const link = source.match(
    /<link\b[^>]*\brel=["'][^"']*canonical[^"']*["'][^>]*>/i,
  );
  if (!link) return '';
  const href = link[0].match(/\bhref=["']([^"']+)["']/i);
  return href ? href[1] : '';
}

function inspectHttpUrl_(url) {
  const direct = UrlFetchApp.fetch(url, {
    method: 'get',
    followRedirects: false,
    muteHttpExceptions: true,
  });
  const status = direct.getResponseCode();
  const headers = direct.getAllHeaders();
  const location = absoluteRedirectUrl_(
    url,
    headers.Location || headers.location || '',
  );
  const finalResponse = UrlFetchApp.fetch(url, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
  });
  return {
    url: url,
    status: status,
    location: location,
    finalStatus: finalResponse.getResponseCode(),
    canonical: canonicalFromHtml_(finalResponse.getContentText()),
  };
}

function isOldKeaUrl_(url) {
  const value = String(url || '').toLowerCase();
  return (
    value.indexOf('www.kea.co.jp/store/') >= 0 ||
    value.indexOf('www.kea.co.jp/store/products/') >= 0 ||
    value.indexOf('products/list.php') >= 0
  );
}

function seoCtrCandidate_(row) {
  return Boolean(
    row &&
    Number(row.impressions || 0) >= 30 &&
    Number(row.ctr || 0) < 0.02,
  );
}

function seoMajorUrlResult_(config, url) {
  const inspection = inspectSearchConsoleUrl_(config, url);
  const index =
    inspection &&
    inspection.inspectionResult &&
    inspection.inspectionResult.indexStatusResult || {};
  const http = inspectHttpUrl_(url);
  const shopifyCanonical = http.canonical || String(index.userCanonical || '');
  const googleCanonical = String(index.googleCanonical || '');
  return {
    url: url,
    indexed: index.verdict ? index.verdict === 'PASS' : null,
    verdict: index.verdict || '',
    coverageState: index.coverageState || '',
    indexingState: index.indexingState || '',
    robotsTxtState: index.robotsTxtState || '',
    lastCrawlTime: index.lastCrawlTime || '',
    crawledAs: index.crawledAs || '',
    googleCanonical: googleCanonical,
    shopifyCanonical: shopifyCanonical,
    canonicalMatches:
      googleCanonical && shopifyCanonical
        ? googleCanonical === shopifyCanonical
        : null,
    httpStatus: http.status,
    finalHttpStatus: http.finalStatus,
    redirectLocation: http.location,
  };
}

function seoRecommendationsFromAudit_(audit) {
  const recommendations = [];
  (audit.queryRows || []).filter(seoCtrCandidate_).slice(0, 20)
    .forEach(function (row) {
      const query = row.keys[0] || '';
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'ctr-query|' + query,
          'SEO改善',
          Number(row.position || 0) <= 15 ? '高' : '中',
          query,
          '表示 ' + row.impressions + ' / CTR ' + percent_(row.ctr) +
            ' / 順位 ' + decimal_(row.position),
          '検索意図に合わせてTitle、Meta Description、内部リンクの変更候補を確認します。',
        ),
      );
    });
  (audit.pageRows || []).filter(seoCtrCandidate_).slice(0, 20)
    .forEach(function (row) {
      const page = row.keys[0] || '';
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'ctr-page|' + page,
          'SEO改善',
          Number(row.position || 0) <= 15 ? '高' : '中',
          page,
          '表示 ' + row.impressions + ' / CTR ' + percent_(row.ctr) +
            ' / 順位 ' + decimal_(row.position),
          'ページのTitle、Meta Description、内部リンクを確認します。',
        ),
      );
    });
  if (audit.clickChangePct !== null && audit.clickChangePct <= -0.3) {
    recommendations.push(
      healthRecommendation_(
        'SEO',
        'click-drop-30',
        'SEO流入',
        '高',
        'Search Consoleクリック',
        '前期間比 ' + percent_(audit.clickChangePct),
        '減少したクエリとページを確認し、Title、内部リンク、在庫公開状態を見直します。',
      ),
    );
  }
  if (audit.sitemap && audit.sitemap.errors > 0) {
    recommendations.push(
      healthRecommendation_(
        'SEO',
        'sitemap-errors',
        'sitemap',
        '高',
        'sitemap.xml',
        'エラー ' + audit.sitemap.errors + ' / 警告 ' + audit.sitemap.warnings,
        'Search Console > サイトマップで対象URLを確認します。自動修正は行いません。',
      ),
    );
  }
  (audit.majorUrls || []).forEach(function (item) {
    if (item.error) return;
    if (item.indexed === false) {
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'not-indexed|' + item.url,
          'インデックス',
          '高',
          item.url,
          item.verdict + ' / ' + item.coverageState,
          'Search Console > URL検査で原因を確認し、必要時だけ登録を申請します。',
        ),
      );
    }
    if (item.canonicalMatches === false) {
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'canonical|' + item.url,
          'canonical',
          '高',
          item.url,
          'Google ' + item.googleCanonical + ' / Shopify ' + item.shopifyCanonical,
          'Shopify canonical、内部リンク、301転送の変更候補を確認します。',
        ),
      );
    }
    if (Number(item.finalHttpStatus || 0) >= 400) {
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'http|' + item.url + '|' + item.finalHttpStatus,
          'URLエラー',
          '高',
          item.url,
          'HTTP ' + item.finalHttpStatus,
          'Shopify公開状態または301転送を確認します。',
        ),
      );
    }
  });
  if ((audit.oldUrls || []).length) {
    recommendations.push(
      healthRecommendation_(
        'SEO',
        'old-ec-search-results',
        '旧EC残存',
        '高',
        'www.kea.co.jp/store/',
        audit.oldUrls.join(' / '),
        '旧URLから対応するShopify URLへの301転送候補を確認します。',
      ),
    );
  }
  (audit.oldHttp || []).forEach(function (item) {
    const permanent = item.status === 301 || item.status === 308;
    const destinationOk = String(item.location || '')
      .indexOf('https://store.kea.co.jp/') === 0;
    if (permanent && destinationOk) return;
    recommendations.push(
      healthRecommendation_(
        'SEO',
        'old-redirect|' + item.url + '|' + item.status + '|' + item.location,
        '301転送',
        '高',
        item.url,
        'HTTP ' + item.status + ' / 転送先 ' + (item.location || 'なし'),
        '旧EC URLを対応するShopify URLへ恒久転送する候補を確認します。',
      ),
    );
  });
  return recommendations;
}

function runSeoHealthAuditCore_(config) {
  const checkedAt = new Date();
  const currentEnd = dateDaysAgo_(3);
  const currentStart = dateDaysAgo_(9);
  const previousEnd = dateDaysAgo_(10);
  const previousStart = dateDaysAgo_(16);
  const current = healthAttempt_('直近7日', function () {
    return searchConsoleAnalytics_(
      config, currentStart, currentEnd, [], 1,
    );
  }, []);
  const previous = healthAttempt_('前7日', function () {
    return searchConsoleAnalytics_(
      config, previousStart, previousEnd, [], 1,
    );
  }, []);
  const queries = healthAttempt_('クエリ', function () {
    return searchConsoleAnalytics_(
      config, currentStart, currentEnd, ['query'], 25000,
    );
  }, []);
  const pages = healthAttempt_('ページ', function () {
    return searchConsoleAnalytics_(
      config, currentStart, currentEnd, ['page'], 25000,
    );
  }, []);
  const devices = healthAttempt_('デバイス', function () {
    return searchConsoleAnalytics_(
      config, currentStart, currentEnd, ['device'], 100,
    );
  }, []);
  const sitemapAttempt = healthAttempt_('sitemap', function () {
    return collectSearchConsoleSitemaps_(config);
  }, null);
  const representative = healthAttempt_('代表商品URL', function () {
    return collectRepresentativeShopifyUrl_(config);
  }, '');
  const majorUrls = KEA_SEO_MAJOR_URLS.slice();
  if (representative.available && representative.value) {
    majorUrls.push(representative.value);
  }
  const majorResults = majorUrls.map(function (url) {
    try {
      return seoMajorUrlResult_(config, url);
    } catch (error) {
      return {
        url: url,
        indexed: null,
        error: String(error && error.message || error),
      };
    }
  });
  const oldHttp = KEA_OLD_EC_URLS.map(function (url) {
    try {
      return inspectHttpUrl_(url);
    } catch (error) {
      return {
        url: url,
        status: 0,
        location: '',
        finalStatus: 0,
        error: String(error && error.message || error),
      };
    }
  });
  const currentSummary = current.available
    ? seoSummaryFromRows_(current.value)
    : { clicks: null, impressions: null, ctr: null, position: null };
  const previousSummary = previous.available
    ? seoSummaryFromRows_(previous.value)
    : { clicks: null, impressions: null, ctr: null, position: null };
  const clickChangePct =
    currentSummary.clicks !== null && previousSummary.clicks > 0
      ? (currentSummary.clicks - previousSummary.clicks) /
        previousSummary.clicks
      : null;
  const oldRows = (pages.value || []).filter(function (row) {
    return isOldKeaUrl_(row.keys[0]);
  });
  const oldUrls = oldRows.map(function (row) {
    return (row.keys[0] || '') + '（表示' + row.impressions + '）';
  });
  const audit = {
    queryRows: queries.value,
    pageRows: pages.value,
    clickChangePct: clickChangePct,
    sitemap: sitemapAttempt.value,
    majorUrls: majorResults,
    oldUrls: oldUrls,
    oldHttp: oldHttp,
  };
  const recommendations = seoRecommendationsFromAudit_(audit);
  const errors = [
    current.error,
    previous.error,
    queries.error,
    pages.error,
    devices.error,
    sitemapAttempt.error,
    representative.error,
  ].filter(Boolean);
  majorResults.forEach(function (item) {
    if (item.error) errors.push(item.url + ': ' + item.error);
  });
  const notificationIssues = [];
  if (sitemapAttempt.value && sitemapAttempt.value.errors > 0) {
    notificationIssues.push({
      key: 'SEO|sitemap-errors',
      text: 'sitemapエラー ' + sitemapAttempt.value.errors + '件',
    });
  }
  majorResults.forEach(function (item) {
    if (item.indexed === false) {
      notificationIssues.push({
        key: 'SEO|not-indexed|' + item.url,
        text: '主要URLがGoogle未登録: ' + item.url,
      });
    }
    if (item.canonicalMatches === false) {
      notificationIssues.push({
        key: 'SEO|canonical|' + item.url,
        text: 'canonical不一致: ' + item.url,
      });
    }
  });
  if (clickChangePct !== null && clickChangePct <= -0.3) {
    notificationIssues.push({
      key: 'SEO|click-drop-30',
      text: 'SEOクリックが前期間比' + percent_(clickChangePct) + 'です。',
    });
  }
  const state = {
    connectionStatus: current.available
      ? errors.length ? 'partial' : 'connected'
      : 'failed',
    clicks: currentSummary.clicks,
    impressions: currentSummary.impressions,
    ctr: currentSummary.ctr,
    position: currentSummary.position,
    clickChangePct: clickChangePct,
    sitemapErrors: sitemapAttempt.value
      ? sitemapAttempt.value.errors
      : null,
    oldUrlCount: pages.available ? oldRows.length : null,
    majorUrls: majorResults.map(function (item) {
      return {
        url: item.url,
        indexed: item.indexed,
        canonicalMatches: item.canonicalMatches,
        finalHttpStatus: item.finalHttpStatus,
      };
    }),
  };
  const previousState = healthReadJsonProperty_('KEA_HEALTH_STATE_SEO', null);
  const changeSummary = [];
  if (previousState && previousState.clicks !== null && state.clicks !== null) {
    changeSummary.push('クリック ' + previousState.clicks + '→' + state.clicks);
  }
  appendHealthRow_('SEOHealth', [
    isoTimestamp_(checkedAt),
    state.connectionStatus,
    dateKey_(currentStart) + '〜' + dateKey_(currentEnd),
    dateKey_(previousStart) + '〜' + dateKey_(previousEnd),
    currentSummary.clicks === null ? '' : currentSummary.clicks,
    previousSummary.clicks === null ? '' : previousSummary.clicks,
    clickChangePct === null ? '' : clickChangePct,
    currentSummary.impressions === null ? '' : currentSummary.impressions,
    currentSummary.ctr === null ? '' : currentSummary.ctr,
    currentSummary.position === null ? '' : currentSummary.position,
    JSON.stringify(devices.value || []),
    sitemapAttempt.value
      ? sitemapAttempt.value.rows.map(function (item) {
          return item.path;
        }).join(', ')
      : '取得不可',
    sitemapAttempt.value ? sitemapAttempt.value.errors : '',
    sitemapAttempt.value ? sitemapAttempt.value.warnings : '',
    sitemapAttempt.value ? sitemapAttempt.value.pending : '',
    JSON.stringify(majorResults),
    pages.available ? oldRows.length : '',
    oldUrls.join(' / '),
    changeSummary.length ? changeSummary.join(' / ') : '変化なし',
    errors.join(' / ').slice(0, 5000),
  ]);
  return {
    source: 'SEO',
    available: current.available,
    connectionStatus: state.connectionStatus,
    reason: errors.join(' / ').slice(0, 3000),
    state: state,
    recommendations: recommendations,
    notificationIssues: notificationIssues,
    checkedAt: isoTimestamp_(checkedAt),
  };
}

function runSeoHealthAudit() {
  return withScriptLock_('runSeoHealthAudit', function () {
    const startedAt = new Date();
    ensureHealthSheets_();
    const result = runHealthMonitorSafely_('SEO', function () {
      return runSeoHealthAuditCore_(keaConfig_());
    });
    return finishSingleHealthWatch_(
      'SEO',
      result,
      'runSeoHealthAudit',
      startedAt,
    );
  });
}

function runSeoHealthAuditNow() {
  return runSeoHealthAudit();
}
