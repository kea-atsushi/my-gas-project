const KEA_HEALTH_SHEETS = Object.freeze({
  MerchantHealth: [
    'checkedAt',
    'totalProducts',
    'approved',
    'pending',
    'disapproved',
    'limited',
    'freeListingsApproved',
    'shoppingAdsApproved',
    'accountIssueCount',
    'criticalIssueCount',
    'topIssueCodes',
    'syncStatus',
    'previousTotal',
    'changeSummary',
    'manualAction',
  ],
  SEOHealth: [
    'checkedAt',
    'connectionStatus',
    'currentPeriod',
    'previousPeriod',
    'clicks',
    'previousClicks',
    'clickChangePct',
    'impressions',
    'ctr',
    'position',
    'deviceSummary',
    'sitemapStatus',
    'sitemapErrors',
    'sitemapWarnings',
    'sitemapPending',
    'majorUrlSummary',
    'oldUrlCount',
    'oldUrls',
    'changeSummary',
    'manualAction',
  ],
  MEOHealth: [
    'checkedAt',
    'connectionStatus',
    'businessName',
    'address',
    'phone',
    'website',
    'regularHours',
    'specialHours',
    'primaryCategory',
    'additionalCategories',
    'attributes',
    'ownerVerified',
    'reviewCount',
    'averageRating',
    'unansweredReviews',
    'latestReviewAt',
    'businessInfoMatches',
    'hoursMatch',
    'websiteMatches',
    'localInventoryLinkStatus',
    'changeSummary',
    'manualAction',
  ],
  GbpConnection: [
    'checkedAt',
    'status',
    'reason',
    'oauthScope',
    'accountId',
    'locationId',
    'candidates',
    'manualAction',
  ],
  ShopifySkuAudit: [
    'checkedAt',
    'connectionStatus',
    'productId',
    'variantId',
    'handle',
    'vendor',
    'title',
    'productStatus',
    'publishedAt',
    'variantTitle',
    'rawProductCode',
    'productCode',
    'size',
    'color',
    'currentSku',
    'expectedSku',
    'auditStatus',
    'issues',
    'selectedOptions',
  ],
});

function ensureHealthSheets_() {
  const spreadsheet = getDashboardSpreadsheet_();
  Object.keys(KEA_HEALTH_SHEETS).forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    const created = !sheet;
    if (created) sheet = spreadsheet.insertSheet(name);
    if (name === KEA_SHOPIFY_SKU_AUDIT_SHEET && !created) return;
    ensureHeader_(sheet, KEA_HEALTH_SHEETS[name]);
    sheet
      .getRange(1, 1, 1, KEA_HEALTH_SHEETS[name].length)
      .setBackground('#111111')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setRowHeight(1, 28);
    sheet.getDataRange().setWrap(true);
  });
  return spreadsheet;
}

function appendHealthRow_(sheetName, row) {
  const sheet = getDashboardSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error(sheetName + 'シートがありません。');
  appendRows_(sheet, [row]);
  pruneSheet_(sheet, 1000);
}

function healthReadJsonProperty_(key, fallback) {
  const text = PropertiesService.getScriptProperties().getProperty(key);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function healthWriteJsonProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(
    key,
    JSON.stringify(value),
  );
}

function stableHealthValue_(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return stableHealthValue_(item);
    });
  }
  if (value && typeof value === 'object') {
    const output = {};
    Object.keys(value).sort().forEach(function (key) {
      output[key] = stableHealthValue_(value[key]);
    });
    return output;
  }
  return value;
}

function healthHash_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(stableHealthValue_(value)),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function healthRecommendation_(
  source,
  key,
  category,
  priority,
  target,
  evidence,
  recommendation,
) {
  const item = recommendation_(
    'health',
    category,
    priority,
    target,
    evidence,
    recommendation,
  );
  item.healthSource = source;
  item.healthKey = source + '|' + key;
  return item;
}

function healthNewAlertItems_(currentItems, previousKeys) {
  const previous = {};
  const seen = {};
  (previousKeys || []).forEach(function (key) {
    previous[String(key)] = true;
  });
  return (currentItems || []).filter(function (item) {
    if (!item || !item.key) return false;
    const key = String(item.key);
    if (previous[key] || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function queueHealthRecommendations_(source, recommendations) {
  const propertyKey = 'KEA_HEALTH_ACTIVE_RECOMMENDATIONS_' + source;
  const previousKeys = healthReadJsonProperty_(propertyKey, []);
  const items = (recommendations || []).filter(function (item) {
    return item && item.healthKey;
  });
  const newItems = healthNewAlertItems_(
    items.map(function (item) {
      return { key: item.healthKey, item: item };
    }),
    previousKeys,
  ).map(function (entry) {
    return entry.item;
  });
  appendRecommendations_(newItems);
  healthWriteJsonProperty_(
    propertyKey,
    items.map(function (item) {
      return item.healthKey;
    }),
  );
  return newItems;
}

function healthConnectionEvents_(source, result) {
  const properties = PropertiesService.getScriptProperties();
  const streakKey = 'KEA_HEALTH_FAILURE_STREAK_' + source;
  const currentStreak = Number(properties.getProperty(streakKey) || 0);
  if (source === 'SHOPIFY_SKU' && result && result.inProgress) {
    return [];
  }
  if (result && result.available) {
    properties.deleteProperty(streakKey);
    return [];
  }
  const nextStreak = currentStreak + 1;
  properties.setProperty(streakKey, String(nextStreak));
  if (nextStreak !== 2) return [];
  return [
    {
      key: source + '|connection-failed|' + String(result && result.reason || ''),
      text:
        source + ' APIの接続失敗が2回連続しました: ' +
        String(result && result.reason || '理由不明'),
    },
  ];
}

function healthSourceEvents_(source, result) {
  const stateKey = 'KEA_HEALTH_STATE_' + source;
  const alertKey = 'KEA_HEALTH_ACTIVE_ALERTS_' + source;
  const previousState = healthReadJsonProperty_(stateKey, null);
  const previousAlertKeys = healthReadJsonProperty_(alertKey, []);
  const currentAlerts = (result && result.notificationIssues) || [];
  const comparableState =
    source === 'SHOPIFY_SKU' && !(result && result.available)
      ? null
      : result && result.state;
  const events = [];

  if (previousState && comparableState) {
    if (source === 'MERCHANT') {
      [
        ['totalProducts', '商品総数'],
        ['approved', '承認数'],
        ['pending', '審査中数'],
        ['disapproved', '不承認数'],
      ].forEach(function (definition) {
        const key = definition[0];
        if (Number(previousState[key]) !== Number(comparableState[key])) {
          events.push({
            key:
              source + '|' + key + '|' + previousState[key] + '>' + comparableState[key],
            text:
              'Merchant ' + definition[1] + ': ' +
              previousState[key] + ' → ' + comparableState[key],
          });
        }
      });
    }
    if (source === 'SHOPIFY_SKU') {
      [
        ['variantCount', '対象バリエーション'],
        ['issueVariantCount', '要確認'],
        ['skuBlankCount', 'SKU空欄'],
        ['skuFormatCount', 'SKU形式違反'],
        ['duplicateSkuCount', 'SKU重複'],
        ['duplicateProductCodeCount', '商品コード重複'],
        ['expectedVendorMismatchCount', '期待ブランド不一致'],
        ['productCodeMissingCount', '商品コード欠落'],
        ['optionIssueCount', 'option異常'],
      ].forEach(function (definition) {
        const key = definition[0];
        if (Number(previousState[key]) !== Number(comparableState[key])) {
          events.push({
            key:
              source + '|' + key + '|' + previousState[key] + '>' +
              comparableState[key],
            text:
              'Shopify SKU ' + definition[1] + ': ' +
              previousState[key] + ' → ' + comparableState[key],
          });
        }
      });
    }
    if (
      source === 'SEO' &&
      comparableState.oldUrlCount !== null &&
      previousState.oldUrlCount !== null &&
      Number(comparableState.oldUrlCount) > Number(previousState.oldUrlCount)
    ) {
      events.push({
        key:
          source + '|old-url-increase|' + previousState.oldUrlCount + '>' +
          comparableState.oldUrlCount,
        text:
          '旧EC URLの検索残存: ' + previousState.oldUrlCount + ' → ' +
          comparableState.oldUrlCount,
      });
    }
  }

  if (previousState && comparableState) {
    healthNewAlertItems_(currentAlerts, previousAlertKeys).forEach(
      function (item) {
        events.push(item);
      },
    );
  }
  events.push.apply(events, healthConnectionEvents_(source, result));

  if (comparableState) healthWriteJsonProperty_(stateKey, comparableState);
  if (
    source !== 'SHOPIFY_SKU' ||
    (result && result.available && !result.inProgress && comparableState)
  ) {
    healthWriteJsonProperty_(
      alertKey,
      currentAlerts.map(function (item) {
        return item.key;
      }),
    );
  }
  return events;
}

function sendHealthChangeNotification_(events, results) {
  if (!events || !events.length) {
    return { status: 'skipped', reason: '状態変化なし' };
  }
  const config = keaConfig_();
  const emails = String(config.REPORT_EMAILS || '')
    .split(',')
    .map(function (email) {
      return email.trim();
    })
    .filter(Boolean);
  if (!emails.length) {
    return { status: 'skipped', reason: 'REPORT_EMAILS未設定' };
  }
  const hash = healthHash_(events.map(function (event) {
    return event.key;
  }).sort());
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('KEA_HEALTH_LAST_NOTIFICATION_HASH') === hash) {
    return { status: 'skipped', reason: '同一内容を通知済み' };
  }
  const lines = [
    'Kea. Growth Opsで状態変化を検出しました。',
    '',
  ];
  events.forEach(function (event) {
    lines.push('- ' + event.text);
  });
  lines.push(
    '',
    '商品・広告・Googleビジネスプロフィールは変更していません。',
    '修正候補はRecommendationsの承認待ちへ追加しています。',
  );
  MailApp.sendEmail({
    to: emails.join(','),
    subject:
      '[Kea.] SKU・SEO・MEO・Merchant状態変化 ' + dateKey_(new Date()),
    body: lines.join('\n'),
    name: 'Kea. Growth Ops',
  });
  properties.setProperty('KEA_HEALTH_LAST_NOTIFICATION_HASH', hash);
  return {
    status: 'sent',
    recipients: emails,
    changes: events.length,
    results: Object.keys(results || {}),
  };
}

function failedHealthResult_(source, error) {
  const reason = String(error && error.message || error || '取得失敗');
  return {
    source: source,
    available: false,
    connectionStatus: 'failed',
    reason: reason,
    state: { connectionStatus: 'failed', reason: reason },
    recommendations: [
      healthRecommendation_(
        source,
        'api-connection',
        'API接続',
        '高',
        source,
        reason,
        'APIの利用許可、OAuth権限、ID設定を確認します。自動変更は行いません。',
      ),
    ],
    notificationIssues: [],
  };
}

function writeFailedHealthRow_(source, reason) {
  if (source === 'SHOPIFY_SKU') {
    healthWriteJsonProperty_('KEA_HEALTH_LAST_FAILURE_SHOPIFY_SKU', {
      checkedAt: isoTimestamp_(new Date()),
      reason: reason,
    });
    return;
  }
  const sheetBySource = {
    MERCHANT: 'MerchantHealth',
    SEO: 'SEOHealth',
    MEO: 'MEOHealth',
  };
  const sheetName = sheetBySource[source];
  if (!sheetName || !KEA_HEALTH_SHEETS[sheetName]) return;
  const row = KEA_HEALTH_SHEETS[sheetName].map(function (header) {
    if (header === 'checkedAt') return isoTimestamp_(new Date());
    if (header === 'connectionStatus') return 'failed';
    if (header === 'syncStatus') return '取得失敗';
    if (header === 'changeSummary') return 'API取得失敗';
    if (header === 'manualAction') return reason;
    if (header === 'issues') return reason;
    return '';
  });
  appendHealthRow_(sheetName, row);
}

function runHealthMonitorSafely_(source, callback) {
  try {
    return callback();
  } catch (error) {
    console.error(source + ': ' + String(error && error.stack || error));
    try {
      writeFailedHealthRow_(
        source,
        String(error && error.message || error),
      );
    } catch (sheetError) {
      console.error(
        source + ' failure row: ' +
        String(sheetError && sheetError.message || sheetError),
      );
    }
    return failedHealthResult_(source, error);
  }
}

function finishHealthResults_(results) {
  const events = [];
  Object.keys(results).forEach(function (source) {
    const result = results[source];
    if (!(source === 'SHOPIFY_SKU' && result && result.inProgress)) {
      queueHealthRecommendations_(source, result.recommendations || []);
    }
    events.push.apply(events, healthSourceEvents_(source, result));
  });
  const email = sendHealthChangeNotification_(events, results);
  return { events: events, email: email };
}

function runGrowthHealthWatchNow() {
  return runGrowthHealthWatch(true);
}

function runGrowthHealthWatch(force) {
  const forceRun = explicitForceRequested_(force);
  const executionDeadlineAtMs = Date.now() + KEA_GAS_SAFE_EXECUTION_MS;
  return withScriptLock_('runGrowthHealthWatch', function () {
    return runGrowthHealthWatchCore_(forceRun, executionDeadlineAtMs);
  });
}

function runGrowthHealthWatchCore_(forceRun, executionDeadlineAtMs) {
  const startedAt = new Date();
  const safeDeadlineAtMs = Number(executionDeadlineAtMs || 0) ||
    startedAt.getTime() + KEA_GAS_SAFE_EXECUTION_MS;
  const properties = PropertiesService.getScriptProperties();
  recoverShopifySkuPublishBeforeAudit_();
  const runKey = 'KEA_HEALTH_SUCCESS_' + dateKey_(new Date());
  if (!forceRun && properties.getProperty(runKey)) {
    return { status: 'skipped', reason: 'already completed' };
  }
  ensureHealthSheets_();
  const config = keaConfig_();
  const results = {};
  results.MERCHANT = runHealthMonitorSafely_('MERCHANT', function () {
    return runMerchantHealthWatchCore_(config);
  });
  results.SEO = runHealthMonitorSafely_('SEO', function () {
    return runSeoHealthAuditCore_(config);
  });
  results.MEO = runHealthMonitorSafely_('MEO', function () {
    return runMeoHealthAuditCore_(config, results.MERCHANT);
  });
  results.SHOPIFY_SKU = runHealthMonitorSafely_('SHOPIFY_SKU', function () {
    return runShopifySkuAuditCore_(
      config,
      safeDeadlineAtMs - KEA_HEALTH_POST_SKU_RESERVE_MS,
    );
  });
  const finalization = finishHealthResults_(results);
  properties.setProperty(runKey, isoTimestamp_(new Date()));
  const output = {
    status: 'completed',
    shopifySku: results.SHOPIFY_SKU,
    merchant: results.MERCHANT,
    seo: results.SEO,
    meo: results.MEO,
    changes: finalization.events.length,
    email: finalization.email,
    dashboardUpdated: true,
  };
  logRun_(
    startedAt,
    'runGrowthHealthWatch',
    'success',
    JSON.stringify({
      shopifySku: results.SHOPIFY_SKU.connectionStatus,
      merchant: results.MERCHANT.connectionStatus,
      seo: results.SEO.connectionStatus,
      meo: results.MEO.connectionStatus,
      changes: finalization.events.length,
      email: finalization.email,
    }),
  );
  return output;
}

function finishSingleHealthWatch_(source, result, handler, startedAt) {
  const results = {};
  results[source] = result;
  const finalization = finishHealthResults_(results);
  logRun_(
    startedAt,
    handler,
    result.inProgress
      ? 'in_progress'
      : result.available
        ? 'success'
        : 'partial',
    JSON.stringify({
      connectionStatus: result.connectionStatus,
      changes: finalization.events.length,
      email: finalization.email,
    }),
  );
  return Object.assign({}, result, {
    changes: finalization.events.length,
    email: finalization.email,
  });
}

function readLatestHealthRow_(sheetName) {
  const spreadsheet = getDashboardSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const values = sheet.getDataRange().getValues();
  const headers = values.shift() || [];
  return rowObject_(headers, values[values.length - 1]);
}

function buildWeeklyHealthSummary_() {
  const merchant = readLatestHealthRow_('MerchantHealth');
  const seo = readLatestHealthRow_('SEOHealth');
  const meo = readLatestHealthRow_('MEOHealth');
  if (!merchant.checkedAt && !seo.checkedAt && !meo.checkedAt) return '';
  const display = function (value, fallback) {
    return value === '' || value === null || typeof value === 'undefined'
      ? fallback
      : value;
  };
  return [
    '',
    '',
    'SEO・MEO・Merchant現在値',
    '- Merchant: 商品 ' + display(merchant.totalProducts, '未取得') +
      ' / 承認 ' + display(merchant.approved, '未取得') +
      ' / 審査中 ' + display(merchant.pending, '未取得') +
      ' / 不承認 ' + display(merchant.disapproved, '未取得'),
    '- SEO: クリック ' + display(seo.clicks, '未取得') +
      ' / 表示 ' + display(seo.impressions, '未取得') +
      ' / sitemapエラー ' +
      display(seo.sitemapErrors, '未取得'),
    '- MEO: 接続 ' + (meo.connectionStatus || '未取得') +
      ' / 口コミ ' + display(meo.reviewCount, '未取得') +
      ' / 未返信 ' +
      display(meo.unansweredReviews, '未取得'),
  ].join('\n');
}
