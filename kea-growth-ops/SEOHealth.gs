const KEA_SEO_MAJOR_URLS = [
  'https://store.kea.co.jp/',
  'https://store.kea.co.jp/collections/all',
  'https://store.kea.co.jp/collections/new-arrival',
];

const KEA_OLD_EC_URLS = [
  'https://www.kea.co.jp/store/',
  'https://www.kea.co.jp/store/products/',
  'https://www.kea.co.jp/store/products/list.php',
  'https://www.kea.co.jp/store/products/list.php?category_id=526',
];

/**
 * 旧ECの対応先を実確認できたURLだけを保持します。
 * 未確認URLをトップページへ一括転送する提案は行いません。
 */
const KEA_OLD_EC_REDIRECT_TARGETS = Object.freeze({
  'https://www.kea.co.jp/store/products/list.php?category_id=526':
    'https://store.kea.co.jp/collections/oblada',
});

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


function normalizeCanonicalUrlForComparison_(url) {
  return String(url || '')
    .trim()
    .replace(/%[0-9a-f]{2}/gi, function (value) {
      return value.toUpperCase();
    });
}

function canonicalUrlsMatch_(leftUrl, rightUrl) {
  const left = normalizeCanonicalUrlForComparison_(leftUrl);
  const right = normalizeCanonicalUrlForComparison_(rightUrl);
  if (!left || !right) return null;
  return left === right;
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

function oldEcRedirectTarget_(url) {
  return KEA_OLD_EC_REDIRECT_TARGETS[String(url || '')] || '';
}

/**
 * 少量表示での即時Title変更提案を防ぐため、十分な表示と順位がある場合だけ候補化します。
 */
function seoCtrCandidate_(row) {
  return Boolean(
    row &&
    Number(row.impressions || 0) >= 100 &&
    Number(row.ctr || 0) < 0.02 &&
    Number(row.position || 0) > 0 &&
    Number(row.position || 0) <= 20,
  );
}

function seoNoiseQueryReason_(query) {
  const value = String(query || '').trim();
  if (!value) return '空クエリ';
  if (value.length < 2) return '短すぎるクエリ';
  if (/https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|jp|site|xyz|top|click)\b/i.test(value)) {
    return 'URL・ドメイン形式';
  }
  if (/[\u{1F300}-\u{1FAFF}]/u.test(value)) return '絵文字を含む不自然なクエリ';
  if (/^[a-z0-9_-]{16,}$/i.test(value) && /\d/.test(value) && /[a-z]/i.test(value)) {
    return '長い英数字列';
  }
  if (/(.)\1{7,}/.test(value)) return '同一文字の異常な連続';
  return '';
}

function seoCommercialIntent_(query, page) {
  const value = String(query || '').toLowerCase();
  const target = String(page || '').toLowerCase();
  let score = 0;
  const signals = [];
  if (/\/products\//.test(target)) {
    score += 3;
    signals.push('商品ページ');
  } else if (/\/collections\//.test(target)) {
    score += 2;
    signals.push('コレクションページ');
  }
  if (
    /(通販|オンライン|購入|買う|価格|値段|在庫|サイズ|カラー|色|取扱|店舗|バッグ|ジャケット|コート|パンツ|シャツ|スカート|ワンピース|アクセサリー|靴|財布|sale|shop|store|price|buy|stock|size)/i.test(value)
  ) {
    score += 2;
    signals.push('購入・商品意図語');
  }
  return { score: score, signals: signals };
}

function seoPriorityCandidateRow_(row) {
  const source = row || {};
  const keys = source.keys || [];
  const query = String(source.query || keys[0] || '').trim();
  const page = String(source.page || keys[1] || '').trim();
  const impressions = Number(source.impressions || 0);
  const ctr = Number(source.ctr || 0);
  const position = Number(source.position || 0);
  const clicks = Number(source.clicks || 0);
  const noiseReason = seoNoiseQueryReason_(query);
  if (
    noiseReason || !page || impressions < 100 || ctr >= 0.02 ||
    position <= 0 || position > 20
  ) {
    return null;
  }
  const intent = seoCommercialIntent_(query, page);
  if (position <= 10) {
    intent.score += 2;
    intent.signals.push('検索上位10位以内');
  } else {
    intent.score += 1;
    intent.signals.push('検索上位20位以内');
  }
  if (impressions >= 200) {
    intent.score += 1;
    intent.signals.push('表示200回以上');
  }
  if (clicks > 0) {
    intent.score += 1;
    intent.signals.push('クリック実績あり');
  }
  if (intent.score < 4) return null;
  return {
    query: query,
    page: page,
    clicks: clicks,
    impressions: impressions,
    ctr: ctr,
    position: position,
    intentScore: intent.score,
    intentSignals: intent.signals,
    score:
      intent.score * 10000 +
      Math.min(impressions, 5000) * 2 +
      Math.max(0, 21 - position) * 100,
  };
}

function seoPriorityCandidates_(rows) {
  const byPage = {};
  (rows || []).forEach(function (row) {
    const candidate = seoPriorityCandidateRow_(row);
    if (!candidate) return;
    if (!byPage[candidate.page]) byPage[candidate.page] = [];
    byPage[candidate.page].push(candidate);
  });
  return Object.keys(byPage).map(function (page) {
    const candidates = byPage[page].sort(function (left, right) {
      return right.score - left.score;
    });
    const top = candidates.slice(0, 3);
    const lead = top[0];
    const queryEvidence = top.map(function (item) {
      return (
        '"' + item.query + '" 表示 ' + item.impressions +
        ' / CTR ' + percent_(item.ctr) +
        ' / 順位 ' + decimal_(item.position) +
        ' / 商業意図 ' + item.intentScore +
        '（' + item.intentSignals.join('・') + '）'
      );
    });
    return {
      page: page,
      priority:
        lead.position <= 10 && lead.impressions >= 200 ? '高' : '中',
      score: lead.score,
      cause:
        '十分な表示と商業意図がある一方、CTRが2%未満です。',
      evidence: '対象ページ ' + page + ' / ' + queryEvidence.join(' / '),
      queries: top,
    };
  }).sort(function (left, right) {
    return right.score - left.score;
  }).slice(0, 5);
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
    canonicalMatches: canonicalUrlsMatch_(googleCanonical, shopifyCanonical),
    httpStatus: http.status,
    finalHttpStatus: http.finalStatus,
    redirectLocation: http.location,
  };
}

function seoRecommendationsFromAudit_(audit) {
  const recommendations = [];
  seoPriorityCandidates_(audit.queryPageRows || []).forEach(function (candidate) {
      recommendations.push(
        healthRecommendation_(
          'SEO',
          'ctr-page|' + candidate.page,
          'SEO改善',
          candidate.priority,
          candidate.page,
          candidate.evidence,
          '実検索結果と対象ページを確認し、Title、Meta Description、内部リンクのうち根拠がある箇所だけ変更します。',
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
  // www.kea.co.jpは通常のTitle・Meta改善候補から除外し、旧URL・301・404の監視専用とします。
  (audit.oldHttp || []).forEach(function (item) {
    const expectedTarget = oldEcRedirectTarget_(item.url);
    if (!expectedTarget) return;
    const permanent = item.status === 301 || item.status === 308;
    const destinationOk = String(item.location || '') === expectedTarget;
    if (permanent && destinationOk) return;
    recommendations.push(
      healthRecommendation_(
        'SEO',
        'old-redirect|' + item.url + '|' + item.status + '|' + item.location,
        '301転送',
        '高',
        item.url,
        'HTTP ' + item.status + ' / 転送先 ' + (item.location || 'なし') +
          ' / 正しい転送先 ' + expectedTarget,
        '旧ObladaページをOblada Collectionへ301または308で恒久転送する候補を確認します。',
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
  }, []);  const previous = healthAttempt_('前7日', function () {
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
  const queryPages = healthAttempt_('クエリ・ページ', function () {
    return searchConsoleAnalytics_(
      config, currentStart, currentEnd, ['query', 'page'], 25000,
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
    queryPageRows: queryPages.value,
    clickChangePct: clickChangePct,
    sitemap: sitemapAttempt.value,
    majorUrls: majorResults,
    oldUrls: oldUrls,
    oldHttp: oldHttp,
  };
  const brandAudit = healthAttempt_('ブランドSEO', function () {
    return runBrandSeoHealthAudit_(config, audit, { force: false });
  }, {
    available: false,
    recommendations: [],
    notificationIssues: [],
    summary: { brandCount: 0, setupCandidates: 0, issueCount: 0 },
  });
  const recommendations = seoRecommendationsFromAudit_(audit).concat(
    brandAudit.value && brandAudit.value.recommendations || [],
  );
  const errors = [
    current.error,
    previous.error,
    queries.error,
    pages.error,
    queryPages.error,
    devices.error,
    sitemapAttempt.error,
    representative.error,
    brandAudit.error,
  ].filter(Boolean);
  majorResults.forEach(function (item) {
    if (item.error) errors.push(item.url + ': ' + item.error);
  });
  const notificationIssues = [];
  if (sitemapAttempt.value && sitemapAttempt.value.errors > 0) {
    notificationIssues.push({
      key: 'SEO|sitemap-errors',
      level: '要対応',
      source: 'SEO',
      title: 'sitemapエラー',
      cause: 'Search Consoleがsitemapエラーを返しています。',
      evidence: 'エラー ' + sitemapAttempt.value.errors + '件',
      action: 'Search Consoleで対象URLとエラー理由を確認します。',
      text: 'sitemapエラー ' + sitemapAttempt.value.errors + '件',
    });
  }
  majorResults.forEach(function (item) {
    if (item.indexed === false) {
      notificationIssues.push({
        key: 'SEO|not-indexed|' + item.url,
        level: '要対応',
        source: 'SEO',
        title: '主要URLがGoogle未登録',
        cause: item.verdict + ' / ' + item.coverageState,
        evidence: item.url + ' / 最終HTTP ' + item.finalHttpStatus,
        action: 'Search ConsoleのURL検査で原因を確認し、必要時だけ登録を申請します。',
        text: '主要URLがGoogle未登録: ' + item.url,
      });
    }
    if (item.canonicalMatches === false) {
      notificationIssues.push({
        key: 'SEO|canonical|' + item.url,
        level: '要対応',
        source: 'SEO',
        title: '主要URLのcanonical不一致',
        cause: 'Google canonicalとShopify canonicalが一致しません。',
        evidence: item.url + ' / Google ' + item.googleCanonical +
          ' / Shopify ' + item.shopifyCanonical,
        action: 'canonical、内部リンク、301の対応関係を確認します。',
        text: 'canonical不一致: ' + item.url,
      });
    }
  });
  if (clickChangePct !== null && clickChangePct <= -0.3) {
    notificationIssues.push({
      key: 'SEO|click-drop-30',
      level: '要確認',
      source: 'SEO',
      title: 'SEOクリックが30%以上減少',
      cause: '直近7日が前7日を30%以上下回りました。',
      evidence: '前期間比 ' + percent_(clickChangePct),
      action: '季節性と対象クエリ・ページを日次ダイジェストで確認します。',
      text: 'SEOクリックが前期間比' + percent_(clickChangePct) + 'です。',
    });
  }  const state = {
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
    brandSummary: brandAudit.value && brandAudit.value.summary || null,
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
    brandAudit.value && brandAudit.value.summary
      ? brandAudit.value.summary.brandCount
      : '',
    brandAudit.value && brandAudit.value.summary
      ? JSON.stringify(brandAudit.value.summary)
      : '',
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
