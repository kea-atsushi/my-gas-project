function buildGrowthSnapshot_(periodEnd, shopify, ga4, ads, merchant, gsc) {
  const sales = shopify.available ? shopify.summary.netSales : 0;
  const adCost = ads.available ? ads.summary.cost : 0;
  const cogs =
    shopify.available ? shopify.summary.estimatedCogs : null;
  const contributionProfit =
    cogs === null ? null : sales - cogs - adCost;
  return {
    periodEnd: dateKey_(periodEnd),
    shopifySales: sales,
    shopifyOrders: shopify.available ? shopify.summary.orderCount : 0,
    estimatedCogs: cogs,
    cogsCoverage: shopify.available
      ? shopify.summary.cogsCoverage
      : 0,
    adCost: adCost,
    contributionProfit: contributionProfit,
    roas: ads.available ? ads.summary.roas : 0,
    cpa:
      ads.available && Number(ads.summary.conversions || 0) > 0
        ? ads.summary.cpa
        : null,
    conversions: ads.available ? ads.summary.conversions : 0,
    ctr: ads.available ? ads.summary.ctr : 0,
    cpc: ads.available ? ads.summary.cpc : 0,
    ga4Sessions: ga4.available ? ga4.summary.sessions : 0,
    ga4Revenue: ga4.available ? ga4.summary.purchaseRevenue : 0,
    gscClicks: gsc.available ? gsc.summary.clicks : 0,
    gscImpressions: gsc.available ? gsc.summary.impressions : 0,
    gscCtr: gsc.available ? gsc.summary.ctr : 0,
    gscPosition: gsc.available ? gsc.summary.position : 0,
    merchantApproved: merchant.available
      ? merchant.summary.approved
      : 0,
    merchantDisapproved: merchant.available
      ? merchant.summary.disapproved
      : 0,
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

function recommendation_(
  cadence,
  category,
  priority,
  target,
  evidence,
  recommendation,
) {
  return {
    createdAt: isoTimestamp_(new Date()),
    cadence: cadence,
    category: category,
    priority: priority,
    target: target || '',
    evidence: evidence || '',
    recommendation: recommendation || '',
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
  if (data.merchant.available && data.merchant.summary.disapproved > 0) {
    recommendations.push(
      recommendation_(
        'daily',
        'Merchant',
        '高',
        '不承認商品',
        data.merchant.summary.disapproved + '件',
        '価格・在庫・画像・識別子の不一致を商品別に修正します。',
      ),
    );
  }
  if (data.gsc.available) {
    data.gsc.rows
      .filter(function (row) {
        return (
          row.impressions >= 30 &&
          row.position <= 15 &&
          row.ctr < 0.02
        );
      })
      .sort(function (left, right) {
        return right.impressions - left.impressions;
      })
      .slice(0, 8)
      .forEach(function (row) {
        recommendations.push(
          recommendation_(
            'daily',
            'SEO改善',
            '中',
            row.page,
            '"' +
              row.query +
              '" 表示 ' +
              row.impressions +
              ' / CTR ' +
              percent_(row.ctr) +
              ' / 順位 ' +
              decimal_(row.position),
            '検索意図に合わせてTitle・Meta Description・内部リンクを見直します。',
          ),
        );
      });
  }
  return recommendations;
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
    const key =
      item.category + '|' + item.target + '|' + item.recommendation;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
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
  const lines = [
    '結論',
    '',
    snapshot.missingSources.length
      ? '未接続データがあるため、増額や自動停止は行いません。'
      : '主要データを取得し、承認が必要な改善候補を整理しました。',
    '',
    '数値',
    '- Shopify売上: ' + yen_(snapshot.shopifySales),
    '- 注文: ' + snapshot.shopifyOrders + '件',
    '- 広告費: ' + yen_(snapshot.adCost),
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
  return (Number(value || 0) * 100).toFixed(1) + '%';
}

function decimal_(value) {
  return Number(value || 0).toFixed(2);
}