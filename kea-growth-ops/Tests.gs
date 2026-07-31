function runKeaGrowthUnitTests() {
  const results = [];
  test_('safeDivide zero denominator', function () {
    assertEqual_(safeDivide_(100, 0), 0);
  }, results);
  test_('zero conversions make CPA unavailable', function () {
    const snapshot = buildGrowthSnapshot_(
      new Date('2026-07-30T00:00:00.000Z'),
      { available: false, reason: 'test' },
      { available: false, reason: 'test' },
      {
        available: true,
        summary: {
          cost: 60,
          roas: 0,
          cpa: 0,
          conversions: 0,
          ctr: 0.043,
          cpc: 60,
        },
      },
      { available: false, reason: 'test' },
      { available: false, reason: 'test' },
    );
    assertEqual_(snapshot.cpa, null);
    assertEqual_(yen_(snapshot.cpa), '—');
  }, results);
  test_('daily narrative defers catalog analysis to weekly report', function () {
    const facts = {
      snapshot: {
        missingSources: [],
        shopifySales: 0,
        shopifyOrders: 0,
        adCost: 60,
        roas: 0,
        cpa: null,
        conversions: 0,
        ctr: 0.043,
        cpc: 60,
        contributionProfit: -60,
      },
      popularProducts: [],
      unsoldProducts: [],
      catalogAvailable: false,
      recommendations: [],
    };
    const dailyReport = deterministicNarrative_('daily', facts);
    assertTrue_(
      dailyReport.indexOf('週次レポートで全商品カタログを確認') >= 0,
    );
    const weeklyReport = deterministicNarrative_(
      'weekly',
      Object.assign({}, facts, { catalogAvailable: true }),
    );
    assertTrue_(weeklyReport.indexOf('今回は該当商品なし') >= 0);
  }, results);
  test_('product SEO catches missing fields', function () {
    const audit = auditShopifyProductSeo_(
      {
        id: 'gid://shopify/Product/1',
        title: 'TEST',
        handle: 'test',
        vendor: '',
        descriptionHtml: '<p>short</p>',
        seo: {},
        variants: { nodes: [{ sku: '' }] },
        featuredMedia: null,
      },
      'https://store.kea.co.jp',
    );
    assertEqual_(audit.status, '要確認');
    assertTrue_(audit.issues.indexOf('ブランドなし') >= 0);
    assertTrue_(audit.issues.indexOf('SKU空欄') >= 0);
  }, results);
  test_('zero-conversion spend produces highest-priority action', function () {
    const snapshot = {
      missingSources: [],
    };
    const recommendations = buildDailyRecommendations_(snapshot, {
      ads: {
        available: true,
        summary: { cost: 1200, conversions: 0 },
        campaigns: [
          {
            name: '一般検索',
            cost: 1200,
            conversions: 0,
            clicks: 40,
          },
        ],
      },
      merchant: { available: true, summary: { disapproved: 0 } },
      gsc: { available: true, rows: [] },
    });
    assertTrue_(
      recommendations.some(function (item) {
        return item.category === '広告計測' && item.priority === '最優先';
      }),
    );
    assertTrue_(
      recommendations.some(function (item) {
        return item.category === '広告停止候補';
      }),
    );
  }, results);
  test_('recommendations are approval-only', function () {
    const item = recommendation_(
      'weekly',
      '予算変更候補',
      '低',
      'Campaign',
      'ROAS 5.00',
      '小幅増額を確認',
    );
    assertEqual_(item.approvalStatus, '承認待ち');
  }, results);
  test_('Google Ads window maps Japan day to account hours', function () {
    const window = googleAdsReportWindow_(
      new Date('2026-07-29T15:00:00.000Z'),
      new Date('2026-07-30T15:00:00.000Z'),
      'America/Los_Angeles',
    );
    assertEqual_(window.queryStartDate, '2026-07-29');
    assertEqual_(window.queryEndDate, '2026-07-30');
    assertEqual_(window.startSlot, '2026-07-29T08');
    assertEqual_(window.endSlot, '2026-07-30T08');
  }, results);
  test_('Google Ads rows keep only Japan report window', function () {
    const window = {
      startSlot: '2026-07-29T08',
      endSlot: '2026-07-30T08',
    };
    const row = function (date, hour, costMicros, clicks) {
      return {
        segments: { date: date, hour: hour },
        campaign: {
          id: '1',
          name: 'TEST',
          status: 'ENABLED',
          advertisingChannelType: 'SEARCH',
        },
        metrics: {
          impressions: '10',
          clicks: String(clicks),
          costMicros: String(costMicros),
          conversions: '0',
          conversionsValue: '0',
        },
      };
    };
    const campaigns = aggregateGoogleAdsCampaignRows_(
      [
        row('2026-07-29', 7, 99000000, 99),
        row('2026-07-29', 8, 1000000, 2),
        row('2026-07-30', 7, 2000000, 1),
        row('2026-07-30', 8, 99000000, 99),
      ],
      window,
    );
    assertEqual_(campaigns.length, 1);
    assertEqual_(campaigns[0].impressions, 20);
    assertEqual_(campaigns[0].clicks, 3);
    assertEqual_(campaigns[0].cost, 3);
  }, results);
  test_('Merchant unregistered 401 is recognized', function () {
    assertTrue_(
      merchantGcpRegistrationMissing_(
        new Error(
          'Merchant lookup failed (401): UNAUTHENTICATED: ' +
            'GCP project is not registered with the merchant account',
        ),
      ),
    );
  }, results);
  test_('only explicit true forces a report rerun', function () {
    assertEqual_(explicitForceRequested_(true), true);
    assertEqual_(explicitForceRequested_(false), false);
    assertEqual_(explicitForceRequested_(undefined), false);
    assertEqual_(
      explicitForceRequested_({ triggerUid: 'time-driven-trigger' }),
      false,
    );
  }, results);
  const failed = results.filter(function (result) {
    return result.status === 'failed';
  });
  console.log(JSON.stringify(results, null, 2));
  if (failed.length) {
    throw new Error(failed.length + '件のテストが失敗しました。');
  }
  return results;
}

function test_(name, callback, results) {
  try {
    callback();
    results.push({ name: name, status: 'passed' });
  } catch (error) {
    results.push({
      name: name,
      status: 'failed',
      message: error.message,
    });
  }
}

function assertEqual_(actual, expected) {
  if (actual !== expected) {
    throw new Error(
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual),
    );
  }
}

function assertTrue_(condition) {
  if (!condition) throw new Error('condition is false');
}

/**
 * Google Ads APIの接続だけを確認します。
 * 広告停止、入札、予算などの変更処理は行いません。
 */
function testGoogleAdsConnection() {
  return withScriptLock_('testGoogleAdsConnection', function () {
    const config = keaConfig_();
    const requiredKeys = [
      'GOOGLE_ADS_CUSTOMER_ID',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    ];
    if (!configured_(config, requiredKeys)) {
      throw new Error(
        'Google Ads接続設定が不足しています: ' +
          requiredKeys
            .filter(function (key) {
              return !String(config[key] || '').trim();
            })
            .join(', '),
      );
    }

    const result = googleAdsSearch_(
      config,
      'SELECT customer.id, customer.descriptive_name, ' +
        'customer.currency_code, customer.time_zone ' +
        'FROM customer LIMIT 1',
    );
    if (!result.available) {
      throw new Error(result.reason || 'Google Ads APIへ接続できませんでした。');
    }
    if (!result.rows.length || !result.rows[0].customer) {
      throw new Error('Google Ads APIは応答しましたが、顧客情報を取得できませんでした。');
    }

    const customer = result.rows[0].customer;
    const output = {
      status: 'passed',
      customerId: String(customer.id || ''),
      accountName: String(customer.descriptiveName || ''),
      currencyCode: String(customer.currencyCode || ''),
      timeZone: String(customer.timeZone || ''),
      loginCustomerId: String(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
        .replace(/\D/g, ''),
      mutationMode: String(config.ADS_MUTATION_MODE || ''),
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  });
}

/**
 * 未完了の外部API接続を一括確認します。
 * Merchant CenterとGoogle Cloudプロジェクトの登録だけを行い、
 * 商品、広告、予算、入札などのデータ変更は行いません。
 */
function testKeaGrowthConnections() {
  return withScriptLock_('testKeaGrowthConnections', function () {
    const config = keaConfig_();
    const checks = [
      growthConnectionCheck_('Merchant Center', function () {
        return testMerchantConnection_(config);
      }),
      growthConnectionCheck_('Shopify', function () {
        return testShopifyConnection_(config);
      }),
      growthConnectionCheck_('GA4', function () {
        return testGa4Connection_(config);
      }),
      growthConnectionCheck_('Search Console', function () {
        return testSearchConsoleConnection_(config);
      }),
    ];
    const failed = checks.filter(function (check) {
      return check.status === 'failed';
    });
    const pending = checks.filter(function (check) {
      return check.status === 'pending';
    });
    const passed = checks.filter(function (check) {
      return check.status === 'passed';
    });
    const output = {
      status: failed.length
        ? 'partial'
        : pending.length
          ? 'pending'
          : 'passed',
      passed: passed.length,
      pending: pending.length,
      failed: failed.length,
      checks: checks,
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  });
}

function growthConnectionCheck_(source, callback) {
  try {
    return Object.assign(
      { source: source, status: 'passed' },
      callback() || {},
    );
  } catch (error) {
    return {
      source: source,
      status: 'failed',
      message: String(error && error.message || error).slice(0, 1200),
    };
  }
}

function testMerchantConnection_(config) {
  const accountId = String(config.MERCHANT_ACCOUNT_ID || '')
    .replace(/\D/g, '');
  if (!accountId) {
    throw new Error('MERCHANT_ACCOUNT_IDが未設定です。');
  }

  const registration = ensureMerchantGcpRegistration_(accountId);
  if (registration.status === 'registered_pending') {
    return {
      status: 'pending',
      accountId: accountId,
      gcpRegistration: 'registered',
      productReport: 'retry_after_propagation',
      message:
        'Merchant登録は完了しました。Google側の反映後に再実行してください。',
    };
  }
  const report = collectMerchant_(config);
  if (!report.available) {
    throw new Error(
      report.reason || 'Merchant Centerの商品レポートを取得できませんでした。',
    );
  }
  return {
    accountId: accountId,
    gcpRegistration: registration.status,
    productReport: 'passed',
    products: report.summary.total,
    approved: report.summary.approved,
    disapproved: report.summary.disapproved,
  };
}

function ensureMerchantGcpRegistration_(accountId) {
  const accountName = 'accounts/' + accountId;
  const registrationName = accountName + '/developerRegistration';
  const lookupUrl =
    'https://merchantapi.googleapis.com/accounts/v1/' +
    'accounts:getAccountForGcpRegistration';
  let current = null;

  try {
    current = googleJson_(
      lookupUrl,
      { method: 'get' },
      'Merchant GCP registration lookup',
    );
  } catch (error) {
    if (!merchantGcpRegistrationMissing_(error)) {
      throw error;
    }
  }

  if (current && current.name) {
    if (String(current.name) !== accountName) {
      throw new Error(
        'このGoogle Cloudプロジェクトは別のMerchant Centerへ登録済みです: ' +
          current.name,
      );
    }
    return { status: 'already_registered' };
  }

  let registration = null;
  try {
    registration = googleJson_(
      'https://merchantapi.googleapis.com/accounts/v1/' +
        registrationName +
        ':registerGcp',
      { method: 'post', payload: {} },
      'Merchant registerGcp',
    );
  } catch (error) {
    if (!/(409|ALREADY_EXISTS)/i.test(String(error && error.message || error))) {
      throw error;
    }
  }

  if (
    registration &&
    registration.name &&
    String(registration.name) !== registrationName
  ) {
    throw new Error(
      'Merchant登録先が一致しません: ' + registration.name,
    );
  }

  return { status: 'registered_pending' };
}

function merchantGcpRegistrationMissing_(error) {
  const message = String(error && error.message || error);
  return (
    /(404|NOT_FOUND)/i.test(message) ||
    (
      /(401|UNAUTHENTICATED)/i.test(message) &&
      /not registered with the merchant account/i.test(message)
    )
  );
}

function testShopifyConnection_(config) {
  if (
    !String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim() &&
    !configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
  ) {
    throw new Error(
      'SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRETが未設定です。',
    );
  }

  CacheService.getScriptCache().remove('KEA_SHOPIFY_ACCESS_TOKEN');
  const scopeData = shopifyGraphql_(
    config,
    'query KeaAccessScopeList {' +
      ' currentAppInstallation { accessScopes { handle } }' +
      '}',
    {},
    'Shopify access scopes',
  );
  const grantedScopes = (
    scopeData.currentAppInstallation &&
    scopeData.currentAppInstallation.accessScopes || []
  )
    .map(function (scope) {
      return String(scope.handle || '');
    })
    .filter(Boolean)
    .sort();
  const requiredScopes = [
    'read_inventory',
    'read_orders',
    'read_products',
  ];
  const missingScopes = requiredScopes.filter(function (scope) {
    return grantedScopes.indexOf(scope) < 0;
  });
  if (missingScopes.length) {
    return {
      status: 'failed',
      storeDomain: String(config.SHOPIFY_STORE_DOMAIN || ''),
      grantedScopes: grantedScopes,
      missingScopes: missingScopes,
      message:
        'Shopifyアプリに必要な権限が付与されていません: ' +
        missingScopes.join(', '),
    };
  }

  const productData = shopifyGraphql_(
    config,
    'query KeaProductReadTest {' +
      ' products(first: 1) { nodes { id } }' +
      '}',
    {},
    'Shopify product read test',
  );
  return {
    storeDomain: String(config.SHOPIFY_STORE_DOMAIN || ''),
    grantedScopes: grantedScopes,
    productRead: 'passed',
    sampledProducts: (
      productData.products &&
      productData.products.nodes || []
    ).length,
  };
}

function testGa4Connection_(config) {
  const propertyId = String(config.GA4_PROPERTY_ID || '').replace(/\D/g, '');
  if (!propertyId) {
    throw new Error('GA4_PROPERTY_IDが未設定です。');
  }
  const report = ga4RunReport_(config, {
    dateRanges: [
      {
        startDate: dateKey_(dateDaysAgo_(7)),
        endDate: dateKey_(dateDaysAgo_(1)),
      },
    ],
    metrics: [{ name: 'sessions' }],
    limit: '1',
  });
  if (!report) {
    throw new Error('GA4 Data APIから応答がありませんでした。');
  }
  const sessions =
    report.rows &&
    report.rows[0] &&
    report.rows[0].metricValues &&
    report.rows[0].metricValues[0]
      ? Number(report.rows[0].metricValues[0].value || 0)
      : 0;
  return {
    propertyId: propertyId,
    reportRead: 'passed',
    sessionsLast7Days: sessions,
  };
}

function testSearchConsoleConnection_(config) {
  const siteUrl = String(config.SEARCH_CONSOLE_SITE_URL || '').trim();
  if (!siteUrl) {
    throw new Error('SEARCH_CONSOLE_SITE_URLが未設定です。');
  }
  const response = googleJson_(
    'https://www.googleapis.com/webmasters/v3/sites/' +
      encodeURIComponent(siteUrl) +
      '/searchAnalytics/query',
    {
      method: 'post',
      payload: {
        startDate: dateKey_(dateDaysAgo_(9)),
        endDate: dateKey_(dateDaysAgo_(3)),
        dimensions: ['date'],
        rowLimit: 1,
        dataState: 'final',
      },
    },
    'Search Console connection test',
  );
  return {
    siteUrl: siteUrl,
    reportRead: 'passed',
    sampledRows: (response.rows || []).length,
  };
}
