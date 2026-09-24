function buildGrowthSnapshot_(periodEnd, shopify, ga4, ads, merchant, gsc) {
  const sales = shopify.available ? shopify.summary.netSales : null;
  const adCost = ads.available ? ads.summary.cost : null;
  const cogs =
    shopify.available ? shopify.summary.estimatedCogs : null;
  const contributionProfit =
    cogs === null || sales === null || adCost === null
      ? null
      : sales - cogs - adCost;
  return {
    periodEnd: dateKey_(periodEnd),
    shopifySales: sales,
    shopifyOrders: shopify.available ? shopify.summary.orderCount : null,
    estimatedCogs: cogs,
    cogsCoverage: shopify.available
      ? shopify.summary.cogsCoverage
      : null,
    adCost: adCost,
    contributionProfit: contributionProfit,
    roas: ads.available ? ads.summary.roas : null,
    cpa:
      ads.available && Number(ads.summary.conversions || 0) > 0
        ? ads.summary.cpa
        : null,
    conversions: ads.available ? ads.summary.conversions : null,
    ctr: ads.available ? ads.summary.ctr : null,
    cpc: ads.available ? ads.summary.cpc : null,
    ga4Sessions: ga4.available ? ga4.summary.sessions : null,
    ga4Revenue: ga4.available ? ga4.summary.purchaseRevenue : null,
    gscClicks: gsc.available ? gsc.summary.clicks : null,
    gscImpressions: gsc.available ? gsc.summary.impressions : null,
    gscCtr: gsc.available ? gsc.summary.ctr : null,
    gscPosition: gsc.available ? gsc.summary.position : null,
    merchantApproved: merchant.available
      ? merchant.summary.approved
      : null,
    merchantDisapproved: merchant.available
      ? merchant.summary.disapproved
      : null,
    sourceStatus: {
      shopify: growthSourceStatus_('Shopify', shopify),
      ga4: growthSourceStatus_('GA4', ga4),
      ads: growthSourceStatus_('Google Ads', ads),
      merchant: growthSourceStatus_('Merchant Center', merchant),
      gsc: growthSourceStatus_('Search Console', gsc),
    },
    missingSources: [
      ['Shopify', shopify],
      ['GA4', ga4],
      ['Google Ads', ads],
      ['Merchant Center', merchant],
      ['Search Console', gsc],
    ]
      .filter(function (pair) {
        return !pair[1].available;
      })
      .map(function (pair) {
        return pair[0] + ': ' + (pair[1].reason || '取得不可');
      }),
  };
}

function growthSourceStatus_(label, result) {
  const source = result || {};
  const collection = source.collection || {};
  return {
    label: label,
    status: collection.status || (source.available ? 'success' : 'failed'),
    fetchedAt: collection.fetchedAt || '',
    apiResponse: collection.apiResponse || '',
    error: collection.error || source.reason || '',
    failureStreak: Number(collection.failureStreak || 0),
    previous: collection.previous || null,
  };
}

function recommendation_(
  cadence,
  category,
  priority,
  target,
  evidence,
  recommendation,
  details,
) {
  const metadata = details || {};
  return {
    createdAt: isoTimestamp_(new Date()),
    cadence: cadence,
    category: category,
    priority: priority,
    target: target || '',
    evidence: evidence || '',
    recommendation: recommendation || '',
    cause: metadata.cause || evidence || '',
    change: metadata.change || recommendation || '',
    expectedEffect:
      metadata.expectedEffect || '根拠に示した問題または機会を安全に改善します。',
    risk:
      metadata.risk ||
      '対象と現状を確認せず一括変更すると誤変更になるため、承認後も対象別に検証します。',
    dedupeKey: metadata.dedupeKey || category + '|' + (target || ''),
    notificationLevel: metadata.notificationLevel || '要確認',
    approvalStatus: '承認待ち',
  };
}

function buildDailyRecommendations_(snapshot, data) {
  const recommendations = [];
  if (snapshot.missingSources.length) {
    recommendations.push(
      recommendation_(
        'daily',
        '計測',
        '最優先',
        'データ連携',
        snapshot.missingSources.join(' / '),
        '未取得データを接続し、推測による入札・予算変更を止めます。',
      ),
    );
  }
  if (data.ads.available && data.ads.summary.cost > 0) {
    if (data.ads.summary.conversions <= 0) {
      recommendations.push(
        recommendation_(
          'daily',
          '広告計測',
          '最優先',
          '購入コンバージョン',
          '広告費 ' +
            yen_(data.ads.summary.cost) +
            ' / Google Ads CV 0',
          'purchaseコンバージョンの発火・重複・値を確認するまで増額しません。',
        ),
      );
    }
    data.ads.campaigns
      .filter(function (campaign) {
        return campaign.cost >= 1000 && campaign.conversions === 0;
      })
      .slice(0, 5)
      .forEach(function (campaign) {
        recommendations.push(
          recommendation_(
            'daily',
            '広告停止候補',
            '高',
            campaign.name,
            '費用 ' +
              yen_(campaign.cost) +
              ' / CV 0 / クリック ' +
              campaign.clicks,
            '検索語句と購入計測を確認し、問題がなければ一時停止を承認します。',
          ),
        );
      });
  }
  if (data.gsc.available) {
    seoPriorityCandidates_(data.gsc.rows || []).forEach(function (candidate) {
        recommendations.push(
          recommendation_(
            'daily',
            'SEO改善',
            candidate.priority,
            candidate.page,
            candidate.evidence,
            '対象ページを実検索結果と照合し、Title・Meta Description・内部リンクのうち根拠がある箇所だけ変更します。',
            {
              cause: candidate.cause,
              expectedEffect: '商業意図の高い検索でクリック率を改善します。',
              risk: '検索意図や現在の表示内容を未確認のまま一括変更すると順位・CTRを悪化させる可能性があります。',
              dedupeKey: 'SEO改善|' + candidate.page,
              notificationLevel: '要確認',
            },
          ),
        );
      });
  }
  return dedupeRecommendations_(recommendations);
}

function buildWeeklyRecommendations_(snapshot, data) {
  const recommendations = buildDailyRecommendations_(snapshot, data).map(
    function (item) {
      item.cadence = 'weekly';
      return item;
    },
  );
  if (data.ads.available) {
    data.ads.searchTerms
      .filter(function (term) {
        return term.cost >= 500 && term.conversions === 0;
      })
      .slice(0, 20)
      .forEach(function (term) {
        recommendations.push(
          recommendation_(
            'weekly',
            '除外キーワード候補',
            '中',
            term.searchTerm,
            term.campaign +
              ' / 費用 ' +
              yen_(term.cost) +
              ' / CV 0',
            '意図が商品購入と一致しない場合のみ除外登録を承認します。',
          ),
        );
      });
    data.ads.searchTerms
      .filter(function (term) {
        return (
          term.conversions >= 1 &&
          term.conversionValue > term.cost
        );
      })
      .sort(function (left, right) {
        return (
          right.conversionValue -
          right.cost -
          (left.conversionValue - left.cost)
        );
      })
      .slice(0, 10)
      .forEach(function (term) {
        recommendations.push(
          recommendation_(
            'weekly',
            '広告追加候補',
            '中',
            term.searchTerm,
            'CV ' +
              decimal_(term.conversions) +
              ' / 価値 ' +
              yen_(term.conversionValue) +
              ' / 費用 ' +
              yen_(term.cost),
            '完全一致またはフレーズ一致の追加候補として内容を確認します。',
          ),
        );
      });
    const targetCpa = nullableNumber_(
      data.config.TARGET_CPA || '',
    );
    const targetRoas = nullableNumber_(
      data.config.TARGET_ROAS || '',
    );
    data.ads.campaigns.forEach(function (campaign) {
      if (
        targetCpa !== null &&
        campaign.conversions > 0 &&
        campaign.cpa > targetCpa * 1.3
      ) {
        recommendations.push(
          recommendation_(
            'weekly',
            '入札変更候補',
            '中',
            campaign.name,
            'CPA ' +
              yen_(campaign.cpa) +
              ' / 目標 ' +
              yen_(targetCpa),
            '検索語句・デバイス・地域を確認してから入札を抑えます。',
          ),
        );
      }
      if (
        targetRoas !== null &&
        campaign.cost >= 1000 &&
        campaign.roas >= targetRoas * 1.3
      ) {
        recommendations.push(
          recommendation_(
            'weekly',
            '予算変更候補',
            '低',
            campaign.name,
            'ROAS ' +
              decimal_(campaign.roas) +
              ' / 目標 ' +
              decimal_(targetRoas),
            '計測の正常性と予算損失率を確認できた場合だけ小幅増額します。',
          ),
        );
      }
    });
  }
  if (data.shopify.available) {
    data.shopify.products.slice(0, 10).forEach(function (product) {
      recommendations.push(
        recommendation_(
          'weekly',
          '商品追加候補',
          '低',
          product.title,
          '売上 ' +
            yen_(product.revenue) +
            ' / 数量 ' +
            product.units,
          '広告・SEO・トップ導線での露出拡大候補として確認します。',
        ),
      );
    });
  }
  if (data.catalog && data.catalog.available) {
    const soldHandles = new Set(
      data.shopify.products.map(function (product) {
        return product.handle;
      }),
    );
    data.catalog.products
      .filter(function (product) {
        return (
          product.publishedAt &&
          product.totalInventory > 0 &&
          !soldHandles.has(product.handle)
        );
      })
      .slice(0, 20)
      .forEach(function (product) {
        recommendations.push(
          recommendation_(
            'weekly',
            '商品除外・改善候補',
            '低',
            product.title,
            '直近集計で売上なし / 在庫 ' + product.totalInventory,
            '在庫・季節性・粗利・閲覧数を確認し、広告除外または商品ページ改善を選びます。',
          ),
        );
      });
  }
  return dedupeRecommendations_(recommendations);
}

function dedupeRecommendations_(recommendations) {
  const seen = {};
  return recommendations.filter(function (item) {
    const key = item.dedupeKey ||
      item.category + '|' + item.target + '|' + item.recommendation;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function operationalFinding_(
  level,
  source,
  key,
  title,
  cause,
  evidence,
  action,
) {
  return {
    level: level,
    source: source || '',
    key: key || source + '|' + title,
    title: title || '',
    cause: cause || '',
    evidence: evidence || '',
    action: action || '',
  };
}

function sourcePreviousEvidence_(status, metric) {
  const previous = status && status.previous;
  if (!previous || !previous.fetchedAt) return '前回成功値なし';
  const summary = previous.summary || {};
  if (metric === 'shopify') {
    return (
      '前回成功 ' + previous.fetchedAt +
      ' / 売上 ' + yen_(summary.netSales) +
      ' / 注文 ' + (summary.orderCount === undefined ? '—' : summary.orderCount + '件')
    );
  }
  if (metric === 'ads') {
    return (
      '前回成功 ' + previous.fetchedAt +
      ' / 広告費 ' + yen_(summary.cost) +
      ' / CV ' + decimal_(summary.conversions)
    );
  }
  return '前回成功 ' + previous.fetchedAt;
}

function sourceStatusEvidence_(status, metric) {
  const parts = [];
  if (status && status.fetchedAt) parts.push('取得時刻 ' + status.fetchedAt);
  if (status && status.apiResponse) parts.push('API応答 ' + status.apiResponse);
  if (status && status.error) parts.push('エラー ' + status.error);
  parts.push(sourcePreviousEvidence_(status, metric));
  return parts.join(' / ');
}

function consolidateOperationalFindings_(findings) {
  const byKey = {};
  (findings || []).forEach(function (finding) {
    if (!finding || !finding.key) return;
    const rank = { '対応不要': 0, '要確認': 1, '要対応': 2 };
    const current = byKey[finding.key];
    if (!current || rank[finding.level] > rank[current.level]) {
      byKey[finding.key] = finding;
    }
  });
  return Object.keys(byKey).map(function (key) {
    return byKey[key];
  }).sort(function (left, right) {
    const rank = { '要対応': 0, '要確認': 1, '対応不要': 2 };
    return rank[left.level] - rank[right.level] ||
      String(left.source).localeCompare(String(right.source));
  });
}

function buildDailyFindings_(snapshot, data, recommendations, health) {
  const findings = [];
  const statuses = snapshot.sourceStatus || {};
  Object.keys(statuses).forEach(function (key) {
    const status = statuses[key];
    if (status.status !== 'failed') return;
    findings.push(
      operationalFinding_(
        status.failureStreak >= 2 ? '要対応' : '要確認',
        status.label,
        'source-failure|' + key,
        status.label + 'の取得失敗',
        status.error || 'API取得失敗',
        sourceStatusEvidence_(status, key),
        status.failureStreak >= 2
          ? '認証・権限・API応答を確認し、0として扱わず復旧します。'
          : '一時障害かを次回取得で再確認します。値は0として扱いません。',
      ),
    );
  });

  if (
    statuses.shopify && statuses.shopify.status === 'success' &&
    Number(snapshot.shopifySales || 0) === 0 &&
    Number(snapshot.shopifyOrders || 0) === 0
  ) {
    findings.push(
      operationalFinding_(
        '対応不要',
        'Shopify',
        'shopify-zero-confirmed',
        '売上・注文は実績0',
        'Shopify Admin APIの取得成功後に0件を確認',
        sourceStatusEvidence_(statuses.shopify, 'shopify'),
        '対応不要。取得失敗とは分けて記録します。',
      ),
    );
  }
  if (
    statuses.ads && statuses.ads.status === 'success' &&
    Number(snapshot.adCost || 0) === 0
  ) {
    findings.push(
      operationalFinding_(
        '対応不要',
        'Google Ads',
        'ads-zero-confirmed',
        '広告費は実績0',
        'Google Ads APIの取得成功後に0円を確認',
        sourceStatusEvidence_(statuses.ads, 'ads'),
        '対応不要。取得失敗とは分けて記録します。',
      ),
    );
  }

  if (
    data.ads.available &&
    Number(data.ads.summary.conversions || 0) <= 0
  ) {
    const adCost = Number(data.ads.summary.cost || 0);
    const shopifyOrders = data.shopify.available
      ? Number(data.shopify.summary.orderCount || 0)
      : null;
    const reviewLevel = shopifyOrders === null
      ? '要確認'
      : shopifyOrders > 0
        ? '要対応'
        : adCost >= 1000
          ? '要確認'
          : '対応不要';
    findings.push(
      operationalFinding_(
        reviewLevel,
        'Google Ads',
        'ads-spend-zero-conversions',
        reviewLevel === '対応不要'
          ? '購入CV 0（経過観察）'
          : '購入CV 0',
        shopifyOrders > 0
          ? 'Shopify注文があるのにGoogle Ads購入CVが0です。'
          : shopifyOrders === null
            ? 'Shopify注文数を取得できないため、広告CV0の妥当性を判定できません。'
            : adCost >= 1000
              ? '広告費が1,000円以上発生し、購入CVが0です。'
              : '広告費は少額で、Shopify注文も0件です。',
        '広告費 ' + yen_(adCost) +
          ' / Google Ads CV 0 / Shopify注文 ' +
          (shopifyOrders === null ? '取得不可' : shopifyOrders + '件'),
        shopifyOrders > 0
          ? '購入コンバージョン計測を確認します。増額はしません。'
          : shopifyOrders === null
            ? 'Shopify取得復旧後に再判定します。広告変更はしません。'
            : adCost >= 1000
              ? '検索語句と購入計測を確認します。未検証の停止・増額はしません。'
              : '経過観察。日次メールは発生させず、費用または注文状況が変わった時に再判定します。',
      ),
    );
  }

  (recommendations || []).forEach(function (item) {
    if (item.category !== 'SEO改善' && item.category !== '広告停止候補') return;
    findings.push(
      operationalFinding_(
        item.notificationLevel || '要確認',
        item.category,
        'recommendation|' + (item.dedupeKey || item.category + '|' + item.target),
        item.category + ': ' + item.target,
        item.cause || item.evidence,
        item.evidence,
        item.change || item.recommendation,
      ),
    );
  });

  const healthEvents = health && (health.findings || health.events) || [];
  healthEvents.forEach(function (event) {
    findings.push(
      operationalFinding_(
        event.level || '要対応',
        event.source || 'Health',
        'health|' + event.key,
        event.title || event.text,
        event.cause || event.text,
        event.evidence || '',
        event.action || '対象を確認し、承認済みの範囲だけ対応します。',
      ),
    );
  });
  if (health && health.status === 'failed') {
    findings.push(
      operationalFinding_(
        '要対応',
        'Growth health watch',
        'health-watch-failed',
        'SEO・MEO・Merchant監視の実行失敗',
        health.reason || '監視処理が完了しませんでした。',
        '日次の売上・広告取得とは別の監視経路で失敗',
        'RunLogと各API接続を確認し、監視値を0として扱わず復旧します。',
      ),
    );
  }
  const hasMerchantHealthEvent = healthEvents.some(function (event) {
    return event.source === 'Merchant Center' ||
      String(event.key || '').indexOf('MERCHANT|') === 0;
  });
  if (
    health && health.merchant && health.merchant.changeAssessment &&
    (
      health.merchant.changeAssessment.level === '対応不要' ||
      !hasMerchantHealthEvent
    )
  ) {
    const assessment = health.merchant.changeAssessment;
    findings.push(
      operationalFinding_(
        assessment.level,
        'Merchant Center',
        'merchant-change|' + assessment.key,
        assessment.title,
        assessment.reason,
        assessment.evidence,
        assessment.action,
      ),
    );
  }
  return consolidateOperationalFindings_(findings);
}

function findingCounts_(findings) {
  return (findings || []).reduce(function (counts, finding) {
    counts[finding.level] = Number(counts[finding.level] || 0) + 1;
    return counts;
  }, { '要対応': 0, '要確認': 0, '対応不要': 0 });
}

function buildDecisionSummary_(findings) {
  const counts = findingCounts_(findings);
  const lines = [
    '自動判定',
    '- 要対応: ' + counts['要対応'] + '件',
    '- 要確認: ' + counts['要確認'] + '件',
    '- 対応不要: ' + counts['対応不要'] + '件',
  ];
  ['要対応', '要確認', '対応不要'].forEach(function (level) {
    const items = (findings || []).filter(function (finding) {
      return finding.level === level;
    });
    if (!items.length) return;
    lines.push('', level);
    items.slice(0, level === '対応不要' ? 5 : 20).forEach(function (item) {
      lines.push(
        '- ' + item.title +
        '｜原因: ' + item.cause +
        (item.evidence ? '｜根拠: ' + item.evidence : '') +
        (item.action ? '｜次: ' + item.action : ''),
      );
    });
  });
  return lines.join('\n');
}

function buildNarrative_(cadence, snapshot, data, recommendations) {
  const popularProducts = data.shopify.available
    ? data.shopify.products.slice(0, 5)
    : [];
  const unsoldProducts =
    data.catalog && data.catalog.available
      ? data.catalog.products
          .filter(function (product) {
            return !data.shopify.products.some(function (sold) {
              return sold.handle === product.handle;
            });
          })
          .slice(0, 5)
      : [];
  const facts = {
    cadence: cadence,
    snapshot: snapshot,
    popularProducts: popularProducts,
    unsoldProducts: unsoldProducts,
    catalogAvailable: Boolean(data.catalog && data.catalog.available),
    recommendations: recommendations.slice(0, 40),
  };
  const config = data.config;
  const ai = openAiNarrative_(
    config,
    [
      'Kea.の集客運用担当として日本語で簡潔に報告してください。',
      '入力数値を変更・推測しないでください。',
      'sourceStatusがfailedの値は0ではなく取得失敗と書き、取得時刻・API応答・エラー・前回成功値を区別してください。',
      '広告停止、入札、予算の変更は提案だけにし、実行したと書かないでください。',
      '構成は「結論」「数値」「人気商品・売れない商品」「広告」「SEO・Merchant」「承認が必要な提案」です。',
      '利益は原価が取得できた場合だけ確定値として扱ってください。',
      'catalogAvailableがfalseなら売れない商品を推測せず、日次は「週次レポートで全商品カタログを確認」としてください。trueで0件なら「今回は該当商品なし」としてください。',
    ].join('\n'),
    facts,
  );
  return ai || deterministicNarrative_(cadence, facts);
}

function deterministicNarrative_(cadence, facts) {
  const snapshot = facts.snapshot;
  const sourceStatus = snapshot.sourceStatus || {};
  const shopifyLine = sourceStatus.shopify && sourceStatus.shopify.status === 'failed'
    ? '- Shopify売上・注文: 取得失敗（' +
      sourceStatusEvidence_(sourceStatus.shopify, 'shopify') + '）'
    : '- Shopify売上: ' + yen_(snapshot.shopifySales) +
      ' / 注文: ' +
      (snapshot.shopifyOrders === null ? '—' : snapshot.shopifyOrders + '件') +
      (sourceStatus.shopify && sourceStatus.shopify.fetchedAt
        ? '（取得成功 ' + sourceStatus.shopify.fetchedAt +
          ' / API応答 ' + sourceStatus.shopify.apiResponse + '）'
        : '');
  const adsLine = sourceStatus.ads && sourceStatus.ads.status === 'failed'
    ? '- 広告費: 取得失敗（' +
      sourceStatusEvidence_(sourceStatus.ads, 'ads') + '）'
    : '- 広告費: ' + yen_(snapshot.adCost) +
      (sourceStatus.ads && sourceStatus.ads.fetchedAt
        ? '（取得成功 ' + sourceStatus.ads.fetchedAt +
          ' / API応答 ' + sourceStatus.ads.apiResponse + '）'
        : '');
  const lines = [
    '結論',
    '',
    snapshot.missingSources.length
      ? '未接続データがあるため、増額や自動停止は行いません。'
      : '主要データを取得し、承認が必要な改善候補を整理しました。',
    '',
    '数値',
    shopifyLine,
    adsLine,
    '- ROAS: ' + decimal_(snapshot.roas),
    '- CPA: ' + yen_(snapshot.cpa),
    '- CV: ' + decimal_(snapshot.conversions),
    '- CTR: ' + percent_(snapshot.ctr),
    '- CPC: ' + yen_(snapshot.cpc),
    '- 貢献利益: ' +
      (snapshot.contributionProfit === null
        ? '原価未取得のため未確定'
        : yen_(snapshot.contributionProfit)),
    '',
    '人気商品',
  ];
  if (facts.popularProducts.length) {
    facts.popularProducts.forEach(function (product) {
      lines.push(
        '- ' +
          product.vendor +
          ' ' +
          product.title +
          ': ' +
          yen_(product.revenue) +
          ' / ' +
          product.units +
          '点',
      );
    });
  } else {
    lines.push('- データなし');
  }
  lines.push('', '売れない商品');
  if (facts.unsoldProducts.length) {
    facts.unsoldProducts.forEach(function (product) {
      lines.push(
        '- ' +
          product.vendor +
          ' ' +
          product.title +
          ': 在庫 ' +
          product.totalInventory,
      );
    });
  } else if (!facts.catalogAvailable) {
    lines.push(
      cadence === 'daily'
        ? '- 週次レポートで全商品カタログを確認'
        : '- 全商品カタログを取得できないため判定不可',
    );
  } else {
    lines.push('- 今回は該当商品なし');
  }
  lines.push('', '改善候補');
  if (facts.recommendations.length) {
    facts.recommendations.slice(0, 20).forEach(function (item) {
      lines.push(
        '- [' +
          item.priority +
          '] ' +
          item.category +
          ' / ' +
          item.target +
          ': ' +
          item.recommendation +
          '（根拠: ' +
          item.evidence +
          '）',
      );
    });
  } else {
    lines.push('- 今回は基準を超える候補なし');
  }
  return lines.join('\n');
}

function yen_(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return (
    '¥' +
    Math.round(Number(value)).toLocaleString('ja-JP')
  );
}

function percent_(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return (Number(value || 0) * 100).toFixed(1) + '%';
}

function decimal_(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return Number(value || 0).toFixed(2);
}
