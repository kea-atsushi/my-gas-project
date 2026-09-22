function managedTriggerHandlers_() {
  return [
    'runDailyGrowthReport',
    'runWeeklyGrowthProposal',
    'monitorNewProducts',
  ];
}

function installKeaGrowthTriggers() {
  const config = keaConfig_();
  const managed = managedTriggerHandlers_();
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (managed.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('runDailyGrowthReport')
    .timeBased()
    .atHour(config.DAILY_REPORT_HOUR)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(KEA_DEFAULTS.TIME_ZONE)
    .create();
  ScriptApp.newTrigger('runWeeklyGrowthProposal')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(config.WEEKLY_REPORT_HOUR)
    .nearMinute(0)
    .everyWeeks(1)
    .inTimezone(KEA_DEFAULTS.TIME_ZONE)
    .create();
  ScriptApp.newTrigger('monitorNewProducts')
    .timeBased()
    .everyHours(1)
    .create();
  return managed;
}

function withScriptLock_(handler, callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log(handler + ': another execution is active');
    return { status: 'skipped', reason: 'concurrent execution' };
  }
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function explicitForceRequested_(force) {
  return force === true;
}

/**
 * Apps Script画面から日次レポートを明示的に再実行します。
 */
function runDailyGrowthReportNow() {
  return runDailyGrowthReport(true);
}

/**
 * Apps Script画面から週次候補を明示的に再実行します。
 */
function runWeeklyGrowthProposalNow() {
  return runWeeklyGrowthProposal(true);
}

function runDailyGrowthReport(force) {
  const forceRun = explicitForceRequested_(force);
  return withScriptLock_('runDailyGrowthReport', function () {
    const startedAt = new Date();
    const config = keaConfig_();
    const periodEnd = dateDaysAgo_(1);
    const runKey = 'KEA_DAILY_SUCCESS_' + dateKey_(periodEnd);
    const properties = PropertiesService.getScriptProperties();
    recoverShopifySkuPublishBeforeAudit_();
    if (!forceRun && properties.getProperty(runKey)) {
      return { status: 'skipped', reason: 'already completed' };
    }
    try {
      const start = startOfDay_(periodEnd);
      const end = startOfDay_(new Date());
      const gscEnd = dateDaysAgo_(3);
      const gscStart = dateDaysAgo_(9);
      const data = collectGrowthSources_(
        config,
        start,
        end,
        gscStart,
        gscEnd,
        false,
      );
      const snapshot = buildGrowthSnapshot_(
        periodEnd,
        data.shopify,
        data.ga4,
        data.ads,
        data.merchant,
        data.gsc,
      );
      const recommendations = buildDailyRecommendations_(snapshot, data);
      const health = safeCollect_(
        'Growth health watch',
        function () {
          return runGrowthHealthWatchCore_(
            forceRun,
            startedAt.getTime() + KEA_GAS_SAFE_EXECUTION_MS,
            { deferNotification: true },
          );
        },
        { status: 'failed', reason: 'SEO・MEO・Merchant監視失敗' },
      );
      const findings = buildDailyFindings_(
        snapshot,
        data,
        recommendations,
        health,
      );
      const notificationFindings = dailyFindingNotificationDelta_(findings);
      const notificationReport = notificationFindings.length
        ? buildDecisionSummary_(notificationFindings)
        : '';
      const report =
        buildBrandRankKpiSummary_() +
        buildDecisionSummary_(findings) + '\n\n' +
        buildNarrative_(
          'daily',
          snapshot,
          data,
          recommendations,
        );
      const findingCounts = findingCounts_(findings);
      const status = snapshot.missingSources.length
        ? '一部データ未取得'
        : findingCounts['要対応']
          ? '要対応'
          : findingCounts['要確認']
            ? '要確認'
            : '対応不要';
      upsertDailySnapshot_(snapshot, report, status);
      writeSourceRows_(snapshot.periodEnd, data);
      appendRecommendations_(recommendations);
      const email = sendGrowthReport_(
        'daily',
        periodEnd,
        notificationReport || report,
        snapshot,
        notificationFindings,
      );
      properties.setProperty(runKey, isoTimestamp_(new Date()));
      logRun_(
        startedAt,
        'runDailyGrowthReport',
        'success',
        JSON.stringify({
          status: status,
          email: email,
          healthStatus: health.status,
          findingCounts: findingCounts,
          notificationFindings: notificationFindings.length,
          missingSources: snapshot.missingSources,
        }),
      );
      return {
        status: status,
        snapshot: snapshot,
        recommendations: recommendations,
        findings: findings,
        notificationFindings: notificationFindings,
        email: email,
        health: health,
      };
    } catch (error) {
      logRun_(
        startedAt,
        'runDailyGrowthReport',
        'error',
        error.stack || error.message,
      );
      notifyFailure_('runDailyGrowthReport', error);
      throw error;
    }
  });
}

function dailyFindingNotificationDelta_(findings) {
  const propertyKey = 'KEA_DAILY_ACTIVE_NOTIFICATION_FINDINGS_V1';
  const previousKeys = healthReadJsonProperty_(propertyKey, []);
  const previous = {};
  previousKeys.forEach(function (key) {
    previous[key] = true;
  });
  const active = (findings || []).filter(function (finding) {
    return finding.level === '要対応' || finding.level === '要確認';
  });
  const currentKeys = active.map(function (finding) {
    return finding.level + '|' + finding.key;
  });
  const newFindings = active.filter(function (finding) {
    return !previous[finding.level + '|' + finding.key];
  });
  healthWriteJsonProperty_(propertyKey, currentKeys);
  return newFindings;
}

function runWeeklyGrowthProposal(force) {
  const forceRun = explicitForceRequested_(force);
  return withScriptLock_('runWeeklyGrowthProposal', function () {
    const startedAt = new Date();
    const config = keaConfig_();
    const periodEnd = dateDaysAgo_(1);
    const weekKey =
      Utilities.formatDate(
        periodEnd,
        KEA_DEFAULTS.TIME_ZONE,
        'YYYY-ww',
      );
    const runKey = 'KEA_WEEKLY_SUCCESS_' + weekKey;
    const properties = PropertiesService.getScriptProperties();
    if (!forceRun && properties.getProperty(runKey)) {
      return { status: 'skipped', reason: 'already completed' };
    }
    try {
      const start = dateDaysAgo_(config.REPORT_LOOKBACK_DAYS);
      const end = new Date();
      const gscEnd = dateDaysAgo_(3);
      const gscStart = dateDaysAgo_(
        config.REPORT_LOOKBACK_DAYS + 2,
      );
      const data = collectGrowthSources_(
        config,
        start,
        end,
        gscStart,
        gscEnd,
        true,
      );
      const snapshot = buildGrowthSnapshot_(
        periodEnd,
        data.shopify,
        data.ga4,
        data.ads,
        data.merchant,
        data.gsc,
      );
      const recommendations = buildWeeklyRecommendations_(snapshot, data);
      const report =
        buildBrandRankKpiSummary_() +
        buildNarrative_(
          'weekly',
          snapshot,
          data,
          recommendations,
        ) + buildWeeklyHealthSummary_();
      appendRecommendations_(recommendations);
      const email = sendGrowthReport_(
        'weekly',
        periodEnd,
        report,
        snapshot,
      );
      properties.setProperty(runKey, isoTimestamp_(new Date()));
      logRun_(
        startedAt,
        'runWeeklyGrowthProposal',
        'success',
        JSON.stringify({
          email: email,
          recommendations: recommendations.length,
          missingSources: snapshot.missingSources,
        }),
      );
      return {
        status: '完了',
        snapshot: snapshot,
        recommendations: recommendations,
        email: email,
      };
    } catch (error) {
      logRun_(
        startedAt,
        'runWeeklyGrowthProposal',
        'error',
        error.stack || error.message,
      );
      notifyFailure_('runWeeklyGrowthProposal', error);
      throw error;
    }
  });
}

function collectGrowthSources_(
  config,
  start,
  end,
  gscStart,
  gscEnd,
  includeCatalog,
) {
  const shopify = collectGrowthSourceWithEvidence_(
    'SHOPIFY',
    'Shopify',
    function () {
      return collectShopifyOrders_(config, start, end);
    },
    {
      available: false,
      reason: '取得失敗',
      products: [],
      summary: emptyShopifySummary_(),
    },
  );
  const ga4 = collectGrowthSourceWithEvidence_(
    'GA4',
    'GA4',
    function () {
      return collectGa4_(config, start, end);
    },
    { available: false, reason: '取得失敗', summary: {}, items: [] },
  );
  const ads = collectGrowthSourceWithEvidence_(
    'ADS',
    'Google Ads',
    function () {
      return collectGoogleAds_(config, start, end);
    },
    {
      available: false,
      reason: '取得失敗',
      campaigns: [],
      searchTerms: [],
      summary: emptyAdsSummary_(),
    },
  );
  const merchant = collectGrowthSourceWithEvidence_(
    'MERCHANT',
    'Merchant Center',
    function () {
      return collectMerchant_(config);
    },
    {
      available: false,
      reason: '取得失敗',
      products: [],
      summary: {
        total: 0,
        approved: 0,
        pending: 0,
        disapproved: 0,
        limited: 0,
      },
    },
  );
  const gsc = collectGrowthSourceWithEvidence_(
    'GSC',
    'Search Console',
    function () {
      return collectSearchConsole_(config, gscStart, gscEnd);
    },
    { available: false, reason: '取得失敗', rows: [], summary: {} },
  );
  const catalog = includeCatalog
    ? safeCollect_(
        'Shopify catalog',
        function () {
          return collectShopifyCatalog_(config);
        },
        { available: false, reason: '取得失敗', products: [] },
      )
    : { available: false, reason: 'daily skip', products: [] };
  return {
    config: config,
    shopify: shopify,
    ga4: ga4,
    ads: ads,
    merchant: merchant,
    gsc: gsc,
    catalog: catalog,
  };
}

function growthSourceCompactSummary_(source, result) {
  const summary = result && result.summary || {};
  if (source === 'SHOPIFY') {
    return {
      netSales: Number(summary.netSales || 0),
      orderCount: Number(summary.orderCount || 0),
    };
  }
  if (source === 'ADS') {
    return {
      cost: Number(summary.cost || 0),
      conversions: Number(summary.conversions || 0),
    };
  }
  if (source === 'MERCHANT') {
    return {
      total: Number(summary.total || 0),
      approved: Number(summary.approved || 0),
      disapproved: Number(summary.disapproved || 0),
    };
  }
  if (source === 'GSC') {
    return {
      clicks: Number(summary.clicks || 0),
      impressions: Number(summary.impressions || 0),
    };
  }
  if (source === 'GA4') {
    return {
      sessions: Number(summary.sessions || 0),
      purchaseRevenue: Number(summary.purchaseRevenue || 0),
    };
  }
  return {};
}

function growthSourceApiResponse_(source, result) {
  if (source === 'SHOPIFY') {
    return 'HTTP成功 / 注文 ' + Number(result.orders && result.orders.length || 0) +
      '件 / 商品集計 ' + Number(result.products && result.products.length || 0) + '行';
  }
  if (source === 'ADS') {
    return 'HTTP成功 / campaign ' + Number(result.campaigns && result.campaigns.length || 0) +
      '行 / search term ' + Number(result.searchTerms && result.searchTerms.length || 0) + '行';
  }
  if (source === 'MERCHANT') {
    return 'HTTP成功 / product_view ' + Number(result.products && result.products.length || 0) + '行';
  }
  if (source === 'GSC') {
    return 'HTTP成功 / query-page ' + Number(result.rows && result.rows.length || 0) + '行';
  }
  if (source === 'GA4') {
    return 'HTTP成功 / item ' + Number(result.items && result.items.length || 0) + '行';
  }
  return 'HTTP成功';
}

function collectGrowthSourceWithEvidence_(
  source,
  label,
  callback,
  fallback,
) {
  const properties = PropertiesService.getScriptProperties();
  const successKey = 'KEA_GROWTH_SOURCE_LAST_SUCCESS_' + source;
  const streakKey = 'KEA_GROWTH_SOURCE_FAILURE_STREAK_' + source;
  const previous = healthReadJsonProperty_(successKey, null);
  const fetchedAt = isoTimestamp_(new Date());
  let result;
  try {
    result = callback();
  } catch (error) {
    console.error(label + ': ' + (error.stack || error.message));
    result = Object.assign({}, fallback, {
      available: false,
      reason: String(error && error.message || error),
    });
  }
  result = result || Object.assign({}, fallback, {
    available: false,
    reason: '空のAPI応答',
  });
  if (result.available) {
    const current = {
      fetchedAt: fetchedAt,
      summary: growthSourceCompactSummary_(source, result),
      apiResponse: growthSourceApiResponse_(source, result),
    };
    healthWriteJsonProperty_(successKey, current);
    properties.deleteProperty(streakKey);
    result.collection = {
      status: 'success',
      fetchedAt: fetchedAt,
      apiResponse: current.apiResponse,
      error: '',
      failureStreak: 0,
      previous: previous,
    };
    return result;
  }
  const failureStreak = Number(properties.getProperty(streakKey) || 0) + 1;
  properties.setProperty(streakKey, String(failureStreak));
  result.collection = {
    status: 'failed',
    fetchedAt: fetchedAt,
    apiResponse: '失敗（数値は採用しない）',
    error: String(result.reason || '取得失敗'),
    failureStreak: failureStreak,
    previous: previous,
  };
  return result;
}

function safeCollect_(label, callback, fallback) {
  try {
    return callback();
  } catch (error) {
    console.error(label + ': ' + (error.stack || error.message));
    const result = Object.assign({}, fallback);
    result.available = false;
    result.reason = error.message;
    return result;
  }
}

function monitorNewProducts() {
  return withScriptLock_('monitorNewProducts', function () {
    const startedAt = new Date();
    const config = keaConfig_();
    const properties = PropertiesService.getScriptProperties();
    const lastCheckText = properties.getProperty(
      'KEA_PRODUCT_MONITOR_LAST_CHECK',
    );
    const since = lastCheckText
      ? new Date(lastCheckText)
      : new Date(Date.now() - 2 * 60 * 60 * 1000);
    try {
      const recent = collectRecentlyPublishedProducts_(config, since);
      const unseen = recent.products.filter(function (product) {
        return !properties.getProperty(
          'KEA_SEEN_PRODUCT_' + product.handle,
        );
      });
      if (!unseen.length) {
        properties.setProperty(
          'KEA_PRODUCT_MONITOR_LAST_CHECK',
          new Date().toISOString(),
        );
        logRun_(
          startedAt,
          'monitorNewProducts',
          'success',
          'new products: 0',
        );
        return { status: '完了', products: 0 };
      }

      const merchantRefresh = safeCollect_(
        'Merchant refresh',
        function () {
          return refreshMerchantDataSource_(config);
        },
        { status: 'failed', message: 'Merchant再取得失敗' },
      );
      const sitemap = safeCollect_(
        'Sitemap submit',
        function () {
          return submitSearchConsoleSitemap_(config);
        },
        { status: 'failed', message: 'サイトマップ送信失敗' },
      );
      const rows = unseen.map(function (product) {
        const seo = auditShopifyProductSeo_(
          product,
          config.STOREFRONT_ORIGIN,
        );
        const inspection = safeCollect_(
          'URL inspection ' + seo.handle,
          function () {
            return inspectSearchConsoleUrl_(config, seo.url);
          },
          { error: 'URL検査失敗' },
        );
        const inspectionResult =
          inspection &&
          inspection.inspectionResult &&
          inspection.inspectionResult.indexStatusResult;
        return {
          detectedAt: isoTimestamp_(new Date()),
          productId: product.id,
          handle: seo.handle,
          productUrl: seo.url,
          seoStatus:
            seo.status +
            (seo.issues.length ? ': ' + seo.issues.join(' / ') : ''),
          merchantRefresh:
            merchantRefresh.status +
            ': ' +
            merchantRefresh.message,
          sitemapSubmit:
            sitemap.status + ': ' + sitemap.message,
          urlInspection: inspectionResult
            ? [
                inspectionResult.verdict,
                inspectionResult.coverageState,
                inspectionResult.googleCanonical,
              ]
                .filter(Boolean)
                .join(' / ')
            : inspection.error || '結果なし',
          adsAction:
            '承認待ちキューへ追加。自動停止・自動増額はしません。',
          manualAction:
            'EC商品はIndexing API対象外です。必要時はSearch Console URL検査画面からインデックス登録をリクエストします。',
        };
      });
      appendProductAutomation_(rows);
      unseen.forEach(function (product) {
        properties.setProperty(
          'KEA_SEEN_PRODUCT_' + product.handle,
          isoTimestamp_(new Date()),
        );
      });
      properties.setProperty(
        'KEA_PRODUCT_MONITOR_LAST_CHECK',
        new Date().toISOString(),
      );
      logRun_(
        startedAt,
        'monitorNewProducts',
        'success',
        'new products: ' + unseen.length,
      );
      return { status: '完了', products: unseen.length, rows: rows };
    } catch (error) {
      logRun_(
        startedAt,
        'monitorNewProducts',
        'error',
        error.stack || error.message,
      );
      notifyFailure_('monitorNewProducts', error);
      throw error;
    }
  });
}

function notifyFailure_(handler, error) {
  const emails = String(keaConfig_().REPORT_EMAILS || '')
    .split(',')
    .map(function (email) {
      return email.trim();
    })
    .filter(Boolean);
  if (!emails.length) return;
  MailApp.sendEmail({
    to: emails.join(','),
    subject: '[Kea.] 自動運用エラー ' + handler,
    body:
      handler +
      '\n\n' +
      String(error.stack || error.message || error).slice(0, 10000),
    name: 'Kea. Growth Ops',
  });
}
