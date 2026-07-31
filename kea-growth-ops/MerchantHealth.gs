function merchantStatusSummary_(products) {
  const summary = {
    totalProducts: 0,
    approved: 0,
    pending: 0,
    disapproved: 0,
    limited: 0,
    freeListingsApproved: 0,
    shoppingAdsApproved: 0,
  };
  (products || []).forEach(function (product) {
    summary.totalProducts += 1;
    if (product.status === 'ELIGIBLE') summary.approved += 1;
    if (product.status === 'PENDING') summary.pending += 1;
    if (product.status === 'NOT_ELIGIBLE_OR_DISAPPROVED') {
      summary.disapproved += 1;
    }
    if (product.status === 'ELIGIBLE_LIMITED') summary.limited += 1;
    (product.statusPerReportingContext || []).forEach(function (context) {
      if (!(context.approvedCountries || []).length) return;
      if (context.reportingContext === 'FREE_LISTINGS') {
        summary.freeListingsApproved += 1;
      }
      if (context.reportingContext === 'SHOPPING_ADS') {
        summary.shoppingAdsApproved += 1;
      }
    });
  });
  return summary;
}

function merchantIssueNeedsAction_(issue) {
  return Boolean(issue && issue.resolution === 'MERCHANT_ACTION');
}

function merchantPriceIssue_(issue) {
  const code = String(issue && issue.code || '').toLowerCase();
  const attribute = String(
    issue && issue.canonicalAttribute || '',
  ).toLowerCase();
  return (
    attribute.indexOf('price') >= 0 ||
    /price.*(missing|required)|(?:missing|required).*price/.test(code)
  );
}

function merchantIssueCounts_(products, accountIssues) {
  const counts = {};
  (products || []).forEach(function (product) {
    (product.itemIssues || []).forEach(function (issue) {
      counts[issue.code] = Number(counts[issue.code] || 0) + 1;
    });
  });
  (accountIssues || []).forEach(function (issue) {
    const code = String(issue.name || 'ACCOUNT_ISSUE').split('/').pop();
    counts['account:' + code] = Number(counts['account:' + code] || 0) + 1;
  });
  return counts;
}

function merchantTopIssueCodes_(counts) {
  return Object.keys(counts || {})
    .sort(function (left, right) {
      return counts[right] - counts[left] || left.localeCompare(right);
    })
    .slice(0, 10)
    .map(function (code) {
      return code + ' (' + counts[code] + ')';
    });
}

function merchantChangeEvents_(current, previous) {
  if (!previous) return [];
  const events = [];
  [
    ['totalProducts', '商品総数'],
    ['approved', '承認'],
    ['pending', '審査中'],
    ['disapproved', '不承認'],
    ['limited', '制限付き'],
  ].forEach(function (definition) {
    const key = definition[0];
    if (Number(current[key]) !== Number(previous[key])) {
      events.push(
        definition[1] + ' ' + previous[key] + '→' + current[key],
      );
    }
  });
  return events;
}

function merchantSyncStatus_(summary, previous, baselineAt, now) {
  if (summary.totalProducts > 7) return 'Shopify同期開始';
  const baseline = baselineAt ? new Date(baselineAt) : null;
  const elapsed = baseline && !Number.isNaN(baseline.getTime())
    ? now.getTime() - baseline.getTime()
    : 0;
  if (summary.totalProducts <= 7 && elapsed >= 48 * 60 * 60 * 1000) {
    return '高優先度: 48時間後も商品同期を確認できません';
  }
  if (
    previous &&
    (
      summary.approved > Number(previous.approved || 0) ||
      summary.pending > Number(previous.pending || 0)
    )
  ) {
    return '承認状態が変化';
  }
  return 'Shopify同期待ち';
}

function merchantLocalInventoryIssue_(accountIssue) {
  const text = [
    accountIssue && accountIssue.name,
    accountIssue && accountIssue.title,
    accountIssue && accountIssue.detail,
  ].join(' ').toLowerCase();
  return /(local|店舗|store).*(inventory|在庫|business profile|ビジネス)/i.test(text) ||
    /(business profile|ビジネス).*(local|店舗|inventory|在庫)/i.test(text);
}

function collectMerchantGbpLinks_(accountId) {
  try {
    const accounts = [];
    let pageToken = '';
    do {
      let url =
        'https://merchantapi.googleapis.com/accounts/v1/accounts/' +
        accountId + '/gbpAccounts?pageSize=100';
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
      const response = googleJson_(
        url,
        { method: 'get' },
        'Merchant GBP accounts',
      );
      (response.gbpAccounts || []).forEach(function (account) {
        accounts.push(account);
      });
      pageToken = response.nextPageToken || '';
    } while (pageToken);
    return {
      available: true,
      count: accounts.length,
      accounts: accounts,
      status: accounts.length ? 'linked' : 'not_linked',
      reason: '',
    };
  } catch (error) {
    return {
      available: false,
      count: null,
      accounts: [],
      status: 'unknown',
      reason: String(error && error.message || error),
    };
  }
}

function merchantHealthRecommendations_(diagnostics, summary, syncStatus) {
  const recommendations = [];
  (diagnostics.products || []).forEach(function (product) {
    (product.itemIssues || [])
      .filter(merchantIssueNeedsAction_)
      .forEach(function (issue) {
        const priceIssue = merchantPriceIssue_(issue);
        recommendations.push(
          healthRecommendation_(
            'MERCHANT',
            'product|' + product.id + '|' + issue.code + '|' + product.status,
            'Merchant商品',
            priceIssue ? '高' : '中',
            product.title || product.offerId,
            [
              'issue ' + issue.code,
              '状態 ' + product.status,
              '影響 ' + issue.severity,
              '国 ' + issue.countries,
              '解決 ' + issue.resolution,
            ].filter(Boolean).join(' / '),
            'Shopifyの商品・価格・在庫を確認します。Merchant APIから商品を書き換えません。',
          ),
        );
      });
  });
  (diagnostics.accountIssues || []).forEach(function (issue) {
    const details = merchantAccountIssueDetails_(issue);
    recommendations.push(
      healthRecommendation_(
        'MERCHANT',
        'account|' + details.code + '|' + details.severity,
        'Merchantアカウント',
        details.severity === 'CRITICAL' ? '最優先' : '高',
        details.title || details.code,
        [details.detail, details.reportingContexts, details.documentationUrl]
          .filter(Boolean)
          .join(' / '),
        'Merchant Centerの診断画面で内容を確認し、承認後に手動で対応します。',
      ),
    );
  });
  if (/48時間/.test(syncStatus)) {
    recommendations.push(
      healthRecommendation_(
        'MERCHANT',
        'shopify-sync-timeout',
        'Merchant同期',
        '高',
        'Shopify Google & YouTube連携',
        '商品数 ' + summary.totalProducts + ' / 初期自動検出 7件から増加なし',
        'ShopifyのGoogle & YouTubeアプリで商品同期状態とエラーを確認します。',
      ),
    );
  }
  return recommendations;
}

function runMerchantHealthWatchCore_(config) {
  const checkedAt = new Date();
  const properties = PropertiesService.getScriptProperties();
  let baselineAt = String(
    config.MERCHANT_SHOPIFY_CONNECTED_AT ||
      properties.getProperty('KEA_MERCHANT_WATCH_BASELINE_AT') || '',
  ).trim();
  if (!baselineAt) {
    baselineAt = checkedAt.toISOString();
    properties.setProperty('KEA_MERCHANT_WATCH_BASELINE_AT', baselineAt);
  }
  const previous = healthReadJsonProperty_('KEA_HEALTH_STATE_MERCHANT', null);
  const diagnostics = collectMerchantIssueDiagnostics_(config);
  writeMerchantIssueDiagnostics_(diagnostics);
  const summary = merchantStatusSummary_(diagnostics.products);
  const issueCounts = merchantIssueCounts_(
    diagnostics.products,
    diagnostics.accountIssues,
  );
  const topIssueCodes = merchantTopIssueCodes_(issueCounts);
  const criticalProductIssues = diagnostics.products.reduce(
    function (count, product) {
      return count + product.itemIssues.filter(function (issue) {
        return (
          issue.severity === 'DISAPPROVED' &&
          issue.resolution === 'MERCHANT_ACTION'
        );
      }).length;
    },
    0,
  );
  const criticalAccountIssues = diagnostics.accountIssues.filter(
    function (issue) {
      return issue.severity === 'CRITICAL';
    },
  ).length;
  const syncStatus = merchantSyncStatus_(
    summary,
    previous,
    baselineAt,
    checkedAt,
  );
  const changes = merchantChangeEvents_(summary, previous);
  const localInventoryIssues = diagnostics.accountIssues.filter(
    merchantLocalInventoryIssue_,
  );
  const gbpLinks = collectMerchantGbpLinks_(diagnostics.accountId);
  const manualActions = [];
  if (/48時間/.test(syncStatus)) {
    manualActions.push('Shopify管理画面 > Google & YouTube > 商品フィードを確認');
  }
  if (diagnostics.accountIssueError) {
    manualActions.push('Merchantアカウントissue取得失敗: ' + diagnostics.accountIssueError);
  }
  if (diagnostics.documentationError) {
    manualActions.push('一部商品の解決URLは取得できませんでした。Merchant Center診断画面で確認');
  }
  const actionableProducts = diagnostics.products.filter(function (product) {
    return product.itemIssues.some(merchantIssueNeedsAction_);
  }).length;
  if (actionableProducts) {
    manualActions.push(
      'Recommendationsの承認後にShopifyの商品情報を修正。対象 ' +
        actionableProducts + '商品',
    );
  }
  if (localInventoryIssues.length || gbpLinks.status === 'not_linked') {
    manualActions.push(
      'Merchant Center > 設定 > ビジネス情報でGoogleビジネスプロフィールの店舗候補を確認',
    );
  }
  const state = Object.assign({}, summary, {
    accountIssueCount: diagnostics.accountIssues.length,
    criticalIssueCount: criticalProductIssues + criticalAccountIssues,
    topIssueCodes: topIssueCodes,
    syncStatus: syncStatus,
    localInventoryLinkStatus:
      localInventoryIssues.length
        ? 'issue'
        : gbpLinks.status,
  });
  const recommendations = merchantHealthRecommendations_(
    diagnostics,
    summary,
    syncStatus,
  );
  const notificationIssues = [];
  diagnostics.accountIssues.filter(function (issue) {
    return issue.severity === 'CRITICAL';
  }).forEach(function (issue) {
    const details = merchantAccountIssueDetails_(issue);
    notificationIssues.push({
      key: 'MERCHANT|critical-account|' + details.code,
      text: 'Merchant重大issue: ' + (details.title || details.code),
    });
  });
  diagnostics.products.forEach(function (product) {
    product.itemIssues.filter(function (issue) {
      return (
        issue.resolution === 'MERCHANT_ACTION' &&
        issue.severity === 'DISAPPROVED'
      );
    }).forEach(function (issue) {
      notificationIssues.push({
        key:
          'MERCHANT|critical-product|' + product.id + '|' + issue.code +
          '|' + product.status,
        text:
          'Merchant商品issue: ' + (product.title || product.offerId) +
          ' / ' + issue.code,
      });
    });
  });
  appendHealthRow_('MerchantHealth', [
    isoTimestamp_(checkedAt),
    summary.totalProducts,
    summary.approved,
    summary.pending,
    summary.disapproved,
    summary.limited,
    summary.freeListingsApproved,
    summary.shoppingAdsApproved,
    diagnostics.accountIssues.length,
    criticalProductIssues + criticalAccountIssues,
    topIssueCodes.join(', '),
    syncStatus,
    previous ? previous.totalProducts : '',
    previous
      ? changes.length ? changes.join(' / ') : '変化なし'
      : '初回基準値',
    manualActions.join(' / '),
  ]);
  return {
    source: 'MERCHANT',
    available: true,
    connectionStatus:
      diagnostics.accountIssueError || diagnostics.documentationError
        ? 'partial'
        : 'connected',
    reason: diagnostics.accountIssueError || diagnostics.documentationError || '',
    state: state,
    recommendations: recommendations,
    notificationIssues: notificationIssues,
    localInventoryLink: gbpLinks,
    checkedAt: isoTimestamp_(checkedAt),
  };
}

function runMerchantHealthWatch() {
  return withScriptLock_('runMerchantHealthWatch', function () {
    const startedAt = new Date();
    ensureHealthSheets_();
    const result = runHealthMonitorSafely_('MERCHANT', function () {
      return runMerchantHealthWatchCore_(keaConfig_());
    });
    return finishSingleHealthWatch_(
      'MERCHANT',
      result,
      'runMerchantHealthWatch',
      startedAt,
    );
  });
}

function runMerchantHealthWatchNow() {
  return runMerchantHealthWatch();
}
