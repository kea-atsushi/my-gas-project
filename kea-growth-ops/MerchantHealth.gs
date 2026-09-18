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

function merchantIssueCategory_(issue) {
  const code = String(issue && issue.code || '').toLowerCase();
  const attribute = String(
    issue && issue.canonicalAttribute || '',
  ).toLowerCase();
  const value = code + ' ' + attribute;
  if (/gtin|barcode|ean|isbn|upc|identifier/.test(value)) {
    return { key: 'gtin', label: 'GTIN・商品識別子' };
  }
  if (/image|画像|picture|thumbnail/.test(value)) {
    return { key: 'image', label: '画像' };
  }
  if (/availability|inventory|quantity|stock|在庫/.test(value)) {
    return { key: 'inventory', label: '在庫・販売可否' };
  }
  if (/price|currency|価格/.test(value)) {
    return { key: 'price', label: '価格' };
  }
  if (/brand|ブランド/.test(value)) {
    return { key: 'brand', label: 'ブランド' };
  }
  if (/mpn|manufacturer.*part/.test(value)) {
    return { key: 'mpn', label: 'MPN' };
  }
  if (/shipping|delivery|送料|配送/.test(value)) {
    return { key: 'shipping', label: '配送・送料' };
  }
  if (/policy|misrepresentation|restricted|prohibited/.test(value)) {
    return { key: 'policy', label: 'ポリシー' };
  }
  return { key: 'other', label: 'その他' };
}

function merchantIssueGroups_(products) {
  const groups = {};
  (products || []).forEach(function (product) {
    (product.itemIssues || [])
      .filter(merchantIssueNeedsAction_)
      .forEach(function (issue) {
        const category = merchantIssueCategory_(issue);
        if (!groups[category.key]) {
          groups[category.key] = {
            key: category.key,
            label: category.label,
            products: {},
            issueCodes: {},
            severities: {},
          };
        }
        const group = groups[category.key];
        const productKey = String(product.id || product.offerId || product.title);
        group.products[productKey] = {
          id: product.id || '',
          offerId: product.offerId || '',
          title: product.title || '',
          status: product.status || '',
        };
        group.issueCodes[issue.code] = Number(group.issueCodes[issue.code] || 0) + 1;
        group.severities[issue.severity || 'UNKNOWN'] = true;
      });
  });
  return Object.keys(groups).map(function (key) {
    const group = groups[key];
    group.productList = Object.keys(group.products).map(function (productKey) {
      return group.products[productKey];
    });
    group.codes = Object.keys(group.issueCodes).sort();
    group.productCount = group.productList.length;
    return group;
  }).sort(function (left, right) {
    return right.productCount - left.productCount ||
      left.label.localeCompare(right.label);
  });
}

function merchantGroupEvidence_(group) {
  const products = (group.productList || []).slice(0, 8).map(function (product) {
    return (product.title || product.offerId || product.id) +
      (product.offerId ? ' [' + product.offerId + ']' : '');
  });
  return [
    '原因分類 ' + group.label,
    '対象 ' + group.productCount + '商品' +
      (products.length ? '（' + products.join('、') +
        (group.productCount > products.length ? 'ほか' : '') + '）' : ''),
    '実issue ' + group.codes.map(function (code) {
      return code + ' (' + group.issueCodes[code] + ')';
    }).join(', '),
  ].join(' / ');
}

function merchantCategoryAction_(categoryKey) {
  const actions = {
    price: '対象商品のShopify表示価格・比較価格とMerchant取得値を照合し、不一致箇所だけ修正します。',
    inventory: '対象商品のShopify在庫・公開状態・販売可否とMerchant取得値を照合し、不一致箇所だけ修正します。',
    image: '対象商品の主画像URL・クロール可否・画像要件を確認し、問題画像だけ修正します。',
    gtin: '一次資料または商品現物でGTINを確認し、確認できた対象だけ識別子を修正します。',
    brand: '一次資料とShopifyブランド値を照合し、根拠がある対象だけ修正します。',
    mpn: '一次資料でメーカー品番を確認し、確認できた対象だけ修正します。',
    shipping: 'Merchantの配送設定とShopify側条件を照合し、影響範囲を確認してから修正します。',
    policy: 'Merchant Centerの詳細と対象ページを確認し、ポリシー違反の原因だけ対応します。',
    other: 'Merchant Centerの実issueと対象商品を確認し、原因が確定した対象だけ修正します。',
  };
  return actions[categoryKey] || actions.other;
}

function merchantChangeAssessment_(current, previous) {
  if (!previous) {
    return {
      level: '対応不要',
      key: 'baseline',
      title: 'Merchant初回基準値を記録',
      reason: '比較元がないため通知せず、次回差分の基準にします。',
      evidence: '商品 ' + current.totalProducts + ' / 承認 ' + current.approved +
        ' / 不承認 ' + current.disapproved,
      action: '対応不要',
    };
  }
  const delta = function (key) {
    return Number(current[key] || 0) - Number(previous[key] || 0);
  };
  const totalDelta = delta('totalProducts');
  const approvedDelta = delta('approved');
  const pendingDelta = delta('pending');
  const disapprovedDelta = delta('disapproved');
  const limitedDelta = delta('limited');
  const evidence =
    '商品 ' + previous.totalProducts + '→' + current.totalProducts +
    ' / 承認 ' + previous.approved + '→' + current.approved +
    ' / 審査中 ' + previous.pending + '→' + current.pending +
    ' / 不承認 ' + previous.disapproved + '→' + current.disapproved +
    ' / 制限 ' + previous.limited + '→' + current.limited;
  if (disapprovedDelta > 0) {
    return {
      level: '要対応',
      key: 'disapproved-increase',
      title: 'Merchant不承認が増加',
      reason: '不承認商品が' + disapprovedDelta + '件増えました。',
      evidence: evidence,
      action: '新たに不承認になった商品と実issueを原因別に確認します。',
    };
  }
  const normalRemovalLimit = Math.max(
    5,
    Math.ceil(Number(previous.totalProducts || 0) * 0.02),
  );
  if (
    totalDelta < 0 && approvedDelta === totalDelta &&
    pendingDelta === 0 && disapprovedDelta === 0 && limitedDelta === 0 &&
    Math.abs(totalDelta) <= normalRemovalLimit
  ) {
    return {
      level: '対応不要',
      key: 'normal-feed-removal',
      title: 'Merchantの正常な対象外変化',
      reason: '商品総数と承認数だけが同数減少し、不承認・審査中・制限は増えていません。削除・非公開等でフィード対象外になったパターンです。',
      evidence: evidence,
      action: '通知せず記録のみ。商品変更は行いません。',
    };
  }
  if (
    totalDelta > 0 && approvedDelta === totalDelta &&
    pendingDelta === 0 && disapprovedDelta === 0 && limitedDelta === 0
  ) {
    return {
      level: '対応不要',
      key: 'normal-approved-addition',
      title: 'Merchant承認商品の正常増加',
      reason: '追加商品がそのまま承認され、不承認等は増えていません。',
      evidence: evidence,
      action: '通知せず記録のみ。',
    };
  }
  if (disapprovedDelta < 0 && pendingDelta <= 0 && limitedDelta <= 0) {
    return {
      level: '対応不要',
      key: 'disapproved-decrease',
      title: 'Merchant不承認が減少',
      reason: '不承認が' + Math.abs(disapprovedDelta) + '件減りました。',
      evidence: evidence,
      action: '改善として記録し、通知しません。',
    };
  }
  if (!totalDelta && !approvedDelta && !pendingDelta && !disapprovedDelta && !limitedDelta) {
    return {
      level: '対応不要',
      key: 'no-change',
      title: 'Merchant状態変化なし',
      reason: '主要件数に変化はありません。',
      evidence: evidence,
      action: '対応不要',
    };
  }
  return {
    level: '要確認',
    key: 'unexplained-change',
    title: 'Merchant状態の要確認変化',
    reason: pendingDelta > 0
      ? '審査中商品が' + pendingDelta + '件増えました。'
      : '正常な追加・削除パターンだけでは説明できない変化です。',
    evidence: evidence,
    action: '日次ダイジェストで対象商品と実issueを確認します。',
  };
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
  merchantIssueGroups_(diagnostics.products).forEach(function (group) {
    const item = healthRecommendation_(
      'MERCHANT',
      'cause-group|' + group.key,
      'Merchant商品',
      group.severities.DISAPPROVED ? '高' : '中',
      group.label + '（MerchantIssuesの該当商品）',
      merchantGroupEvidence_(group),
      merchantCategoryAction_(group.key),
      {
        cause: group.label + ': ' + group.codes.join(', '),
        expectedEffect: '対象商品の不承認・掲載制限の解消を確認できます。',
        risk: '一次情報を確認せず一括変更すると価格・在庫・識別子等を誤るため、対象別に確認します。',
        dedupeKey: 'MERCHANT|cause-group|' + group.key,
        notificationLevel: group.severities.DISAPPROVED ? '要対応' : '要確認',
      },
    );
    recommendations.push(item);
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
    disapprovedIssueKeys: diagnostics.products.reduce(function (keys, product) {
      product.itemIssues.forEach(function (issue) {
        if (issue.resolution === 'MERCHANT_ACTION' && issue.severity === 'DISAPPROVED') {
          keys.push(product.id + '|' + issue.code);
        }
      });
      return keys;
    }, []).sort(),
  });
  const changeAssessment = merchantChangeAssessment_(state, previous);
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
      level: '要対応',
      source: 'Merchant Center',
      title: 'Merchantアカウント重大issue',
      cause: details.title || details.code,
      evidence: [details.detail, details.reportingContexts, details.documentationUrl]
        .filter(Boolean).join(' / '),
      action: 'Merchant Centerの診断詳細を確認し、承認後に対象設定だけ対応します。',
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
        level: '要対応',
        source: 'Merchant Center',
        title: 'Merchant商品不承認: ' + (product.title || product.offerId),
        cause: merchantIssueCategory_(issue).label + ' / ' + issue.code,
        evidence:
          '対象 ' + (product.title || product.offerId) +
          ' [' + (product.offerId || product.id) + '] / 状態 ' + product.status +
          ' / 影響 ' + issue.severity + ' / 国 ' + issue.countries,
        action: merchantCategoryAction_(merchantIssueCategory_(issue).key),
        groupKey: 'MERCHANT|' + merchantIssueCategory_(issue).key,
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
    changeAssessment: changeAssessment,
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
