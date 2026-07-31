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
      const report = buildNarrative_(
        'daily',
        snapshot,
        data,
        recommendations,
      );
      const status = snapshot.missingSources.length
        ? '一部データ未取得'
        : '完了';
      upsertDailySnapshot_(snapshot, report, status);
      writeSourceRows_(snapshot.periodEnd, data);
      appendRecommendations_(recommendations);
      const health = safeCollect_(
        'Growth health watch',
        function () {
          return runGrowthHealthWatchCore_(forceRun);
        },
        { status: 'failed', reason: 'SEO・MEO・Merchant監視失敗' },
      );
      const email = sendGrowthReport_(
        'daily',
        periodEnd,
        report,
        snapshot,
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
          missingSources: snapshot.missingSources,
        }),
      );
      return {
        status: status,
        snapshot: snapshot,
        recommendations: recommendations,
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
  const shopify = safeCollect_(
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
  const ga4 = safeCollect_(
    'GA4',
    function () {
      return collectGa4_(config, start, end);
    },
    { available: false, reason: '取得失敗', summary: {}, items: [] },
  );
  const ads = safeCollect_(
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
  const merchant = safeCollect_(
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
  const gsc = safeCollect_(
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
