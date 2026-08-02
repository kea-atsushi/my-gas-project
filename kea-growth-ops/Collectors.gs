function amount_(moneySet) {
  const value =
    moneySet &&
    moneySet.shopMoney &&
    moneySet.shopMoney.amount !== undefined
      ? Number(moneySet.shopMoney.amount)
      : 0;
  return Number.isFinite(value) ? value : 0;
}

function microsToCurrency_(value) {
  return Number(value || 0) / 1000000;
}

function safeDivide_(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  return bottom ? top / bottom : 0;
}

function collectShopifyOrders_(config, startDate, endDate) {
  if (
    !String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim() &&
    !configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
  ) {
    return {
      available: false,
      reason: 'Shopify Admin API設定未完了',
      orders: [],
      products: [],
      summary: emptyShopifySummary_(),
    };
  }
  const search =
    'created_at:>=' +
    dateKey_(startDate) +
    ' created_at:<' +
    dateKey_(endDate);
  let after = null;
  let includeCost = true;
  const orders = [];
  do {
    let data;
    try {
      data = fetchShopifyOrdersPage_(
        config,
        search,
        after,
        includeCost,
      );
    } catch (error) {
      if (
        includeCost &&
        /inventory|unitcost|access denied|permission/i.test(error.message)
      ) {
        includeCost = false;
        data = fetchShopifyOrdersPage_(
          config,
          search,
          after,
          includeCost,
        );
      } else {
        throw error;
      }
    }
    const connection = data.orders || { nodes: [], pageInfo: {} };
    orders.push.apply(orders, connection.nodes || []);
    after = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);
  return summarizeShopifyOrders_(orders, config.DEFAULT_COGS_RATE, includeCost);
}

function fetchShopifyOrdersPage_(
  config,
  search,
  after,
  includeCost,
) {
  const costSelection = includeCost
    ? 'variant { inventoryItem { unitCost { amount currencyCode } } }'
    : '';
  const query =
    'query KeaGrowthOrders($after: String, $search: String!) {' +
    ' orders(first: 100, after: $after, query: $search, sortKey: CREATED_AT) {' +
    '  nodes {' +
    '   id name createdAt cancelledAt displayFinancialStatus' +
    '   currentSubtotalPriceSet { shopMoney { amount currencyCode } }' +
    '   currentTotalPriceSet { shopMoney { amount currencyCode } }' +
    '   totalRefundedSet { shopMoney { amount currencyCode } }' +
    '   lineItems(first: 100) {' +
    '    nodes {' +
    '     title vendor sku quantity currentQuantity' +
    '     discountedUnitPriceSet { shopMoney { amount currencyCode } }' +
    '     product { id handle } ' +
    costSelection +
    '    }' +
    '   }' +
    '  }' +
    '  pageInfo { hasNextPage endCursor }' +
    ' }' +
    '}';
  return shopifyGraphql_(
    config,
    query,
    { after: after, search: search },
    'Shopify orders',
  );
}

function emptyShopifySummary_() {
  return {
    netSales: 0,
    totalOrderValue: 0,
    refunds: 0,
    orderCount: 0,
    estimatedCogs: null,
    cogsCoverage: 0,
  };
}

function summarizeShopifyOrders_(orders, fallbackCogsRate, costAccess) {
  const productsByKey = {};
  let netSales = 0;
  let totalOrderValue = 0;
  let refunds = 0;
  let cogs = 0;
  let costedRevenue = 0;
  let totalRevenueForItems = 0;
  const validOrders = orders.filter(function (order) {
    return !order.cancelledAt;
  });
  validOrders.forEach(function (order) {
    netSales += amount_(order.currentSubtotalPriceSet);
    totalOrderValue += amount_(order.currentTotalPriceSet);
    refunds += amount_(order.totalRefundedSet);
    ((order.lineItems && order.lineItems.nodes) || []).forEach(function (item) {
      const quantity = Math.max(
        0,
        Number(
          item.currentQuantity !== undefined
            ? item.currentQuantity
            : item.quantity,
        ) || 0,
      );
      const unitRevenue = amount_(item.discountedUnitPriceSet);
      const revenue = unitRevenue * quantity;
      totalRevenueForItems += revenue;
      const unitCost =
        item.variant &&
        item.variant.inventoryItem &&
        item.variant.inventoryItem.unitCost
          ? Number(item.variant.inventoryItem.unitCost.amount)
          : null;
      let estimatedCost = null;
      if (Number.isFinite(unitCost)) {
        estimatedCost = unitCost * quantity;
        costedRevenue += revenue;
      } else if (fallbackCogsRate !== null) {
        estimatedCost = revenue * fallbackCogsRate;
        costedRevenue += revenue;
      }
      if (estimatedCost !== null) cogs += estimatedCost;
      const key =
        (item.product && item.product.handle) ||
        item.sku ||
        item.title;
      if (!productsByKey[key]) {
        productsByKey[key] = {
          handle: (item.product && item.product.handle) || '',
          vendor: item.vendor || '',
          title: item.title || '',
          units: 0,
          revenue: 0,
          estimatedCogs: 0,
          costKnown: true,
        };
      }
      const product = productsByKey[key];
      product.units += quantity;
      product.revenue += revenue;
      if (estimatedCost === null) {
        product.costKnown = false;
      } else {
        product.estimatedCogs += estimatedCost;
      }
    });
  });
  const products = Object.keys(productsByKey)
    .map(function (key) {
      const product = productsByKey[key];
      if (!product.costKnown) product.estimatedCogs = null;
      return product;
    })
    .sort(function (left, right) {
      return right.revenue - left.revenue;
    });
  return {
    available: true,
    orders: validOrders,
    products: products,
    summary: {
      netSales: netSales,
      totalOrderValue: totalOrderValue,
      refunds: refunds,
      orderCount: validOrders.length,
      estimatedCogs:
        costAccess || fallbackCogsRate !== null ? cogs : null,
      cogsCoverage: safeDivide_(costedRevenue, totalRevenueForItems),
    },
  };
}

function collectRecentlyPublishedProducts_(config, sinceDate) {
  if (
    !String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim() &&
    !configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
  ) {
    return { available: false, products: [] };
  }
  const search =
    'status:active updated_at:>=' +
    Utilities.formatDate(
      sinceDate,
      KEA_DEFAULTS.TIME_ZONE,
      "yyyy-MM-dd'T'HH:mm:ssXXX",
    );
  const data = shopifyGraphql_(
    config,
    'query KeaRecentProducts($search: String!) {' +
      ' products(first: 100, query: $search, sortKey: UPDATED_AT, reverse: true) {' +
      '  nodes {' +
      '   id title handle vendor status publishedAt updatedAt onlineStoreUrl' +
      '   descriptionHtml seo { title description }' +
      '   featuredMedia { preview { image { url altText width height } } }' +
      '   variants(first: 100) { nodes { id title sku price } }' +
      '  }' +
      ' }' +
      '}',
    { search: search },
    'Shopify recent products',
  );
  const products = ((data.products && data.products.nodes) || []).filter(
    function (product) {
      return product.status === 'ACTIVE' && product.publishedAt;
    },
  );
  return { available: true, products: products };
}

function collectShopifyCatalog_(config) {
  if (
    !String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim() &&
    !configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
  ) {
    return {
      available: false,
      reason: 'Shopify Admin API設定未完了',
      products: [],
    };
  }
  let after = null;
  const products = [];
  do {
    const data = shopifyGraphql_(
      config,
      'query KeaCatalog($after: String) {' +
        ' products(first: 250, after: $after, query: "status:active", sortKey: UPDATED_AT, reverse: true) {' +
        '  nodes {' +
        '   id title handle vendor status publishedAt updatedAt totalInventory onlineStoreUrl' +
        '  }' +
        '  pageInfo { hasNextPage endCursor }' +
        ' }' +
        '}',
      { after: after },
      'Shopify product catalog',
    );
    const connection = data.products || { nodes: [], pageInfo: {} };
    products.push.apply(products, connection.nodes || []);
    after = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);
  return { available: true, products: products };
}

/**
 * Shopifyの商品状態を限定せず、全バリエーションの商品識別情報を取得します。
 * SKUは読み取り専用です。商品コードはcustom.product_codeだけを正とします。
 */
function collectShopifySkuCatalogPage_(config, query, variables) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return shopifyGraphql_(
        config,
        query,
        variables,
        'Shopify SKU catalog',
      );
    } catch (error) {
      lastError = error;
      if (!/throttl/i.test(String(error && error.message || error))) {
        throw error;
      }
      if (attempt < 4) Utilities.sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError;
}

function shopifyNumericGid_(gid) {
  const match = String(gid || '').match(/\/(\d+)$/);
  return match ? match[1] : '';
}

function collectShopifySkuCatalog_(config) {
  if (
    !String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim() &&
    !configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
  ) {
    throw new Error('Shopify Admin API設定未完了');
  }

  let after = null;
  let idQuery = null;
  let hasMore = true;
  let partitionVariantCount = 0;
  const variants = [];
  const productIds = {};
  const variantIds = {};
  const partitionSize = 20000;
  const query =
    'query KeaShopifySkuCatalog($after: String, $query: String) {' +
    ' productVariants(first: 100, after: $after, sortKey: ID, query: $query) {' +
    '  nodes {' +
    '   id title sku selectedOptions { name value }' +
    '   product {' +
    '    id title handle vendor status publishedAt' +
    '    productCode: metafield(namespace: "custom", key: "product_code") { value }' +
    '   }' +
    '  }' +
    '  pageInfo { hasNextPage endCursor }' +
    ' }' +
    '}';
  while (hasMore) {
    const data = collectShopifySkuCatalogPage_(config, query, {
      after: after,
      query: idQuery,
    });
    const connection = data.productVariants || { nodes: [], pageInfo: {} };
    const nodes = connection.nodes || [];
    nodes.forEach(function (variant) {
      if (!variant.id || variantIds[variant.id]) {
        throw new Error('Shopify SKU catalogでvariant IDの欠落・重複を検出しました。');
      }
      variantIds[variant.id] = true;
      variants.push(variant);
      partitionVariantCount += 1;
      if (variant.product && variant.product.id) {
        productIds[variant.product.id] = true;
      }
    });
    if (connection.pageInfo && connection.pageInfo.hasNextPage) {
      if (!nodes.length) {
        throw new Error('Shopify SKU catalogの次ページ対象が空です。');
      }
      if (partitionVariantCount >= partitionSize) {
        const lastNumericId = shopifyNumericGid_(nodes[nodes.length - 1].id);
        if (!lastNumericId) {
          throw new Error('Shopify variant IDからページ分割位置を取得できません。');
        }
        idQuery = 'id:>' + lastNumericId;
        after = null;
        partitionVariantCount = 0;
        continue;
      }
      if (!connection.pageInfo.endCursor) {
        throw new Error('Shopify SKU catalogのページカーソルがありません。');
      }
      after = connection.pageInfo.endCursor;
    } else {
      hasMore = false;
    }
  }

  return {
    available: true,
    products: Object.keys(productIds).length,
    variants: variants,
  };
}

function auditShopifyProductSeo_(product, storefrontOrigin) {
  const text = String(product.descriptionHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const variants =
    (product.variants && product.variants.nodes) || [];
  const image =
    product.featuredMedia &&
    product.featuredMedia.preview &&
    product.featuredMedia.preview.image;
  const issues = [];
  if (!String(product.title || '').trim()) issues.push('商品名なし');
  if (!String(product.vendor || '').trim()) issues.push('ブランドなし');
  if (text.length < 80) issues.push('商品説明が短い');
  if (!image) issues.push('代表画像なし');
  if (image && !String(image.altText || '').trim()) issues.push('画像ALTなし');
  if (
    variants.some(function (variant) {
      return !String(variant.sku || '').trim();
    })
  ) {
    issues.push('SKU空欄');
  }
  if (!String(product.seo && product.seo.description || '').trim()) {
    issues.push('商品SEO説明なし');
  }
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    url:
      product.onlineStoreUrl ||
      storefrontOrigin + '/products/' + product.handle,
    status: issues.length ? '要確認' : 'OK',
    issues: issues,
  };
}

function ga4RunReport_(config, requestBody) {
  const propertyId = String(config.GA4_PROPERTY_ID || '').replace(/\D/g, '');
  if (!propertyId) return null;
  return googleJson_(
    'https://analyticsdata.googleapis.com/v1beta/properties/' +
      propertyId +
      ':runReport',
    {
      method: 'post',
      payload: requestBody,
    },
    'GA4 Data API',
  );
}

function collectGa4_(config, startDate, endDate) {
  if (!String(config.GA4_PROPERTY_ID || '').trim()) {
    return {
      available: false,
      reason: 'GA4_PROPERTY_ID未設定',
      summary: {},
      items: [],
    };
  }
  const dates = [
    {
      startDate: dateKey_(startDate),
      endDate: dateKey_(new Date(endDate.getTime() - 86400000)),
    },
  ];
  const summaryReport = ga4RunReport_(config, {
    dateRanges: dates,
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'transactions' },
      { name: 'purchaseRevenue' },
    ],
  });
  const itemReport = ga4RunReport_(config, {
    dateRanges: dates,
    dimensions: [{ name: 'itemName' }, { name: 'itemBrand' }],
    metrics: [{ name: 'itemsPurchased' }, { name: 'itemRevenue' }],
    orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
    limit: '50',
  });
  const values =
    summaryReport &&
    summaryReport.rows &&
    summaryReport.rows[0] &&
    summaryReport.rows[0].metricValues
      ? summaryReport.rows[0].metricValues.map(function (item) {
          return Number(item.value || 0);
        })
      : [0, 0, 0, 0];
  const items = ((itemReport && itemReport.rows) || []).map(function (row) {
    return {
      title: row.dimensionValues[0].value,
      brand: row.dimensionValues[1].value,
      units: Number(row.metricValues[0].value || 0),
      revenue: Number(row.metricValues[1].value || 0),
    };
  });
  return {
    available: true,
    summary: {
      sessions: values[0],
      activeUsers: values[1],
      transactions: values[2],
      purchaseRevenue: values[3],
    },
    items: items,
  };
}

function googleAdsAccountTimeZone_(config) {
  const configuredTimeZone = String(
    config.GOOGLE_ADS_TIME_ZONE || '',
  ).trim();
  if (configuredTimeZone) {
    validateGoogleAdsTimeZone_(configuredTimeZone);
    return configuredTimeZone;
  }

  const result = googleAdsSearch_(
    config,
    'SELECT customer.time_zone FROM customer LIMIT 1',
  );
  if (!result.available) {
    throw new Error(
      result.reason || 'Google Adsアカウントのタイムゾーンを取得できませんでした。',
    );
  }
  const customer =
    result.rows && result.rows[0] && result.rows[0].customer;
  const timeZone = String(customer && customer.timeZone || '').trim();
  if (!timeZone) {
    throw new Error(
      'Google Adsアカウントのタイムゾーンが空です。',
    );
  }
  validateGoogleAdsTimeZone_(timeZone);
  return timeZone;
}

function validateGoogleAdsTimeZone_(timeZone) {
  try {
    Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  } catch (error) {
    throw new Error(
      'Google Adsアカウントのタイムゾーンが不正です: ' + timeZone,
    );
  }
}

function googleAdsHourSlot_(date, timeZone) {
  const datePart = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(date, timeZone, 'H'));
  return datePart + 'T' + ('0' + hour).slice(-2);
}

function googleAdsReportWindow_(startDate, endDate, accountTimeZone) {
  validateGoogleAdsTimeZone_(accountTimeZone);
  const reportStart = startOfDay_(startDate);
  const reportEnd = startOfDay_(endDate);
  if (reportStart.getTime() >= reportEnd.getTime()) {
    throw new Error('Google Ads集計期間が不正です。');
  }
  return {
    queryStartDate: Utilities.formatDate(
      reportStart,
      accountTimeZone,
      'yyyy-MM-dd',
    ),
    queryEndDate: Utilities.formatDate(
      new Date(reportEnd.getTime() - 1),
      accountTimeZone,
      'yyyy-MM-dd',
    ),
    startSlot: googleAdsHourSlot_(reportStart, accountTimeZone),
    endSlot: googleAdsHourSlot_(reportEnd, accountTimeZone),
  };
}

function googleAdsRowInReportWindow_(row, window) {
  const segments = row && row.segments || {};
  const date = String(segments.date || '');
  const hour = Number(segments.hour);
  if (
    !date ||
    !Number.isFinite(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    return false;
  }
  const slot = date + 'T' + ('0' + hour).slice(-2);
  return slot >= window.startSlot && slot < window.endSlot;
}

function aggregateGoogleAdsCampaignRows_(rows, window) {
  const campaignsById = {};
  (rows || [])
    .filter(function (row) {
      return googleAdsRowInReportWindow_(row, window);
    })
    .forEach(function (row) {
      const campaign = row.campaign || {};
      const id = String(campaign.id || '');
      const key = id || String(campaign.name || '');
      if (!key) return;
      if (!campaignsById[key]) {
        campaignsById[key] = {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          channel: campaign.advertisingChannelType,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
          conversionValue: 0,
        };
      }
      const item = campaignsById[key];
      const metrics = row.metrics || {};
      item.impressions += Number(metrics.impressions || 0);
      item.clicks += Number(metrics.clicks || 0);
      item.cost += microsToCurrency_(metrics.costMicros);
      item.conversions += Number(metrics.conversions || 0);
      item.conversionValue += Number(metrics.conversionsValue || 0);
    });

  return Object.keys(campaignsById)
    .map(function (key) {
      const campaign = campaignsById[key];
      campaign.ctr = safeDivide_(
        campaign.clicks,
        campaign.impressions,
      );
      campaign.cpc = safeDivide_(campaign.cost, campaign.clicks);
      campaign.cpa = safeDivide_(
        campaign.cost,
        campaign.conversions,
      );
      campaign.roas = safeDivide_(
        campaign.conversionValue,
        campaign.cost,
      );
      return campaign;
    })
    .sort(function (left, right) {
      return right.cost - left.cost;
    });
}

function collectGoogleAds_(config, startDate, endDate) {
  const accountTimeZone = googleAdsAccountTimeZone_(config);
  const window = googleAdsReportWindow_(
    startDate,
    endDate,
    accountTimeZone,
  );
  const campaignResult = googleAdsSearch_(
    config,
    'SELECT segments.date, segments.hour, campaign.id, campaign.name, ' +
      'campaign.status, campaign.advertising_channel_type, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      'metrics.conversions, metrics.conversions_value ' +
      "FROM campaign WHERE segments.date BETWEEN '" +
      window.queryStartDate +
      "' AND '" +
      window.queryEndDate +
      "' AND campaign.status != 'REMOVED' " +
      'ORDER BY metrics.cost_micros DESC',
  );
  if (!campaignResult.available) {
    return {
      available: false,
      reason: campaignResult.reason,
      campaigns: [],
      searchTerms: [],
      summary: emptyAdsSummary_(),
    };
  }
  const campaigns = aggregateGoogleAdsCampaignRows_(
    campaignResult.rows,
    window,
  );

  // 検索語句は改善候補用の参考値として、広告アカウントの日付単位で取得します。
  const searchStart = dateKey_(startDate);
  const searchEnd = dateKey_(
    new Date(endDate.getTime() - 86400000),
  );
  const searchTermResult = googleAdsSearch_(
    config,
    'SELECT search_term_view.search_term, campaign.name, ad_group.name, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      'metrics.conversions, metrics.conversions_value ' +
      "FROM search_term_view WHERE segments.date BETWEEN '" +
      searchStart +
      "' AND '" +
      searchEnd +
      "' ORDER BY metrics.cost_micros DESC LIMIT 500",
  );
  const searchTerms = (searchTermResult.rows || []).map(function (row) {
    const metrics = row.metrics || {};
    return {
      searchTerm:
        row.searchTermView && row.searchTermView.searchTerm,
      campaign: row.campaign && row.campaign.name,
      adGroup: row.adGroup && row.adGroup.name,
      impressions: Number(metrics.impressions || 0),
      clicks: Number(metrics.clicks || 0),
      cost: microsToCurrency_(metrics.costMicros),
      conversions: Number(metrics.conversions || 0),
      conversionValue: Number(metrics.conversionsValue || 0),
    };
  });
  const summary = campaigns.reduce(function (accumulator, campaign) {
    accumulator.impressions += campaign.impressions;
    accumulator.clicks += campaign.clicks;
    accumulator.cost += campaign.cost;
    accumulator.conversions += campaign.conversions;
    accumulator.conversionValue += campaign.conversionValue;
    return accumulator;
  }, emptyAdsSummary_());
  summary.ctr = safeDivide_(summary.clicks, summary.impressions);
  summary.cpc = safeDivide_(summary.cost, summary.clicks);
  summary.cpa = safeDivide_(summary.cost, summary.conversions);
  summary.roas = safeDivide_(summary.conversionValue, summary.cost);
  return {
    available: true,
    campaigns: campaigns,
    searchTerms: searchTerms,
    summary: summary,
    accountTimeZone: accountTimeZone,
    reportWindow: {
      startSlot: window.startSlot,
      endSlot: window.endSlot,
    },
  };
}

function emptyAdsSummary_() {
  return {
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    conversionValue: 0,
    ctr: 0,
    cpc: 0,
    cpa: 0,
    roas: 0,
  };
}

function collectMerchant_(config) {
  if (!String(config.MERCHANT_ACCOUNT_ID || '').trim()) {
    return {
      available: false,
      reason: 'MERCHANT_ACCOUNT_ID未設定',
      products: [],
      summary: {
        total: 0,
        approved: 0,
        pending: 0,
        disapproved: 0,
        limited: 0,
      },
    };
  }
  const accountId = String(config.MERCHANT_ACCOUNT_ID).replace(/\D/g, '');
  const url =
    'https://merchantapi.googleapis.com/reports/v1/accounts/' +
    accountId +
    '/reports:search';
  let pageToken = '';
  const products = [];
  do {
    const body = {
      query:
        'SELECT id, offer_id, title, brand, availability, ' +
        'aggregated_reporting_context_status, status_per_reporting_context, ' +
        'item_issues FROM product_view',
      pageSize: 1000,
    };
    if (pageToken) body.pageToken = pageToken;
    const response = googleJson_(
      url,
      { method: 'post', payload: body },
      'Merchant reports.search',
    );
    (response.results || []).forEach(function (row) {
      const view = row.productView || {};
      products.push({
        id: view.id || '',
        offerId: view.offerId || '',
        title: view.title || '',
        brand: view.brand || '',
        availability: view.availability || '',
        status: view.aggregatedReportingContextStatus || '',
        statusPerReportingContext: view.statusPerReportingContext || [],
        issues: (view.itemIssues || []).map(function (issue) {
          return merchantIssueDetails_(issue).code;
        }),
      });
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  const summary = products.reduce(
    function (accumulator, product) {
      accumulator.total += 1;
      if (product.status === 'ELIGIBLE') accumulator.approved += 1;
      if (product.status === 'PENDING') accumulator.pending += 1;
      if (product.status === 'ELIGIBLE_LIMITED') accumulator.limited += 1;
      if (product.status === 'NOT_ELIGIBLE_OR_DISAPPROVED') {
        accumulator.disapproved += 1;
      }
      return accumulator;
    },
    { total: 0, approved: 0, pending: 0, disapproved: 0, limited: 0 },
  );
  return { available: true, products: products, summary: summary };
}

function refreshMerchantDataSource_(config) {
  if (
    !configured_(config, ['MERCHANT_ACCOUNT_ID', 'MERCHANT_DATA_SOURCE_ID'])
  ) {
    return {
      status: 'skipped',
      message: 'Shopify Google & YouTube連携の自動同期を利用',
    };
  }
  const accountId = String(config.MERCHANT_ACCOUNT_ID).replace(/\D/g, '');
  const dataSourceId = String(config.MERCHANT_DATA_SOURCE_ID).replace(/\D/g, '');
  googleJson_(
    'https://merchantapi.googleapis.com/datasources/v1/accounts/' +
      accountId +
      '/dataSources/' +
      dataSourceId +
      ':fetch',
    { method: 'post', payload: {} },
    'Merchant data source fetch',
  );
  return { status: 'submitted', message: 'データソース再取得を実行' };
}

function collectSearchConsole_(config, startDate, endDate) {
  const siteUrl = String(config.SEARCH_CONSOLE_SITE_URL || '').trim();
  if (!siteUrl) {
    return {
      available: false,
      reason: 'SEARCH_CONSOLE_SITE_URL未設定',
      rows: [],
      summary: {},
    };
  }
  const url =
    'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(siteUrl) +
    '/searchAnalytics/query';
  const response = googleJson_(
    url,
    {
      method: 'post',
      payload: {
        startDate: dateKey_(startDate),
        endDate: dateKey_(endDate),
        dimensions: ['query', 'page'],
        rowLimit: 25000,
        dataState: 'final',
      },
    },
    'Search Console searchAnalytics',
  );
  const rows = (response.rows || []).map(function (row) {
    return {
      query: row.keys && row.keys[0] || '',
      page: row.keys && row.keys[1] || '',
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0),
    };
  });
  const totals = rows.reduce(
    function (accumulator, row) {
      accumulator.clicks += row.clicks;
      accumulator.impressions += row.impressions;
      accumulator.positionWeighted += row.position * row.impressions;
      return accumulator;
    },
    { clicks: 0, impressions: 0, positionWeighted: 0 },
  );
  return {
    available: true,
    rows: rows,
    summary: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: safeDivide_(totals.clicks, totals.impressions),
      position: safeDivide_(
        totals.positionWeighted,
        totals.impressions,
      ),
    },
  };
}

function inspectSearchConsoleUrl_(config, inspectionUrl) {
  return googleJson_(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'post',
      payload: {
        inspectionUrl: inspectionUrl,
        siteUrl: config.SEARCH_CONSOLE_SITE_URL,
        languageCode: 'ja-JP',
      },
    },
    'Search Console URL inspection',
  );
}

function submitSearchConsoleSitemap_(config) {
  const siteUrl = String(config.SEARCH_CONSOLE_SITE_URL || '').trim();
  const sitemapUrl = String(
    config.SEARCH_CONSOLE_SITEMAP_URL ||
      KEA_DEFAULTS.SEARCH_CONSOLE_SITEMAP_URL,
  ).trim();
  if (!siteUrl || !sitemapUrl) {
    return { status: 'skipped', message: 'Search Console設定未完了' };
  }
  googleJson_(
    'https://www.googleapis.com/webmasters/v3/sites/' +
      encodeURIComponent(siteUrl) +
      '/sitemaps/' +
      encodeURIComponent(sitemapUrl),
    { method: 'put' },
    'Search Console sitemap submit',
  );
  return { status: 'submitted', message: sitemapUrl };
}
