function runKeaGrowthUnitTests() {
  const results = [];
  test_('safeDivide zero denominator', function () {
    assertEqual_(safeDivide_(100, 0), 0);
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
