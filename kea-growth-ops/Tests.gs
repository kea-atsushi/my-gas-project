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
  test_('SKU parts are normalized without splitting product codes', function () {
    assertEqual_(normalizeSkuPart_(' Ｆｒｅｅ '), 'FREE');
    assertEqual_(normalizeSkuPart_('dark navy'), 'DARK-NAVY');
    assertEqual_(shopifyNumericGid_('gid://shopify/ProductVariant/123'), '123');
    assertEqual_(
      buildExpectedSku_('AB-123', 'one size', 'black'),
      'AB-123-ONE-SIZE-BLACK',
    );
    const productCode = productCodeIdentity_({
      productCode: { value: 'ａｂ １２３' },
    });
    assertEqual_(productCode.normalized, 'AB-123');
    assertEqual_(productCode.valid, true);
    assertTrue_(
      productCode.issues.indexOf('PRODUCT_CODE_NORMALIZATION') >= 0,
    );
  }, results);
  test_('CH0096S requires Chloé even when the product code is unique', function () {
    const auditOne = function (productCode, vendor) {
      return buildShopifySkuAudit_([
        {
          id: 'variant-' + productCode + '-' + vendor,
          title: 'Default Title',
          sku: normalizeSkuPart_(productCode) + '-FREE-ONECOLOR',
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          product: {
            id: 'product-' + productCode + '-' + vendor,
            handle: 'test',
            vendor: vendor,
            title: 'TEST',
            status: 'ACTIVE',
            productCode: { value: productCode },
          },
        },
      ]);
    };
    const correct = auditOne('CH0096S', 'Chlo\u00e9');
    assertEqual_(correct.summary.expectedVendorMismatchCount, 0);
    const decomposed = auditOne('CH0096S', 'chloe\u0301');
    assertEqual_(decomposed.summary.expectedVendorMismatchCount, 0);
    const fullwidthCode = auditOne('\uff43\uff48\uff10\uff10\uff19\uff16\uff53', 'CHLO\u00c9');
    assertEqual_(fullwidthCode.summary.expectedVendorMismatchCount, 0);
    const accentMissing = auditOne('CH0096S', 'Chloe');
    assertEqual_(accentMissing.summary.expectedVendorMismatchCount, 1);
    assertTrue_(
      shopifySkuRecommendations_(accentMissing.summary).some(function (item) {
        return item.evidence.indexOf('CH0096S') >= 0 &&
          item.evidence.indexOf('Chlo\u00e9') >= 0;
      }),
    );
    assertTrue_(
      accentMissing.rows[0].issueCodes.indexOf(
        'PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH',
      ) >= 0,
    );
    assertTrue_(
      accentMissing.rows[0].issueCodes.indexOf(
        'PRODUCT_CODE_BRAND_CONFLICT',
      ) < 0,
    );
    const unrelatedCode = auditOne('CH0096S-X', 'select');
    assertEqual_(unrelatedCode.summary.expectedVendorMismatchCount, 0);
  }, results);
  test_('missing size and color options use explicit fallback values', function () {
    const options = resolveSkuSelectedOptions_([
      { name: 'Title', value: 'Default Title' },
    ]);
    assertEqual_(options.size, 'FREE');
    assertEqual_(options.color, 'ONECOLOR');
    assertEqual_(options.valid, true);
    assertEqual_(
      buildExpectedSku_('2059242', options.size, options.color),
      '2059242-FREE-ONECOLOR',
    );
  }, results);
  test_('SKU option order follows names rather than Shopify position', function () {
    const options = resolveSkuSelectedOptions_([
      { name: 'Color', value: 'Black' },
      { name: 'Size Detail', value: 'One Size' },
    ]);
    assertEqual_(options.size, 'ONE-SIZE');
    assertEqual_(options.color, 'BLACK');
    assertEqual_(options.valid, true);
  }, results);
  test_('blank option values are errors and not fallback values', function () {
    const options = resolveSkuSelectedOptions_([
      { name: 'Size', value: '' },
      { name: 'Color', value: 'Black' },
    ]);
    assertEqual_(options.size, '');
    assertEqual_(options.color, 'BLACK');
    assertEqual_(options.valid, false);
    assertTrue_(
      options.issues.indexOf('SIZE_OPTION_VALUE_MISSING') >= 0,
    );
  }, results);
  test_('full SKU audit separates identity and finds all issue types', function () {
    const product = function (id, code, status) {
      return {
        id: 'gid://shopify/Product/' + id,
        handle: 'product-' + id,
        vendor: 'TEST',
        title: 'PRODUCT ' + id,
        status: status,
        productCode: code === null ? null : { value: code },
      };
    };
    const audit = buildShopifySkuAudit_(
      [
        {
          id: 'v1',
          title: 'M / BLACK',
          sku: '2059242-M-BLACK',
          selectedOptions: [
            { name: 'Size', value: 'M' },
            { name: 'Color', value: 'Black' },
          ],
          product: product('1', '2059242', 'ACTIVE'),
        },
        {
          id: 'v2',
          title: 'M / BLACK duplicate',
          sku: '2059242-M-BLACK',
          selectedOptions: [
            { name: 'Color', value: 'BLACK' },
            { name: 'Size', value: 'M' },
          ],
          product: product('1', '2059242', 'ACTIVE'),
        },
        {
          id: 'v3',
          title: 'FREE / BLACK',
          sku: 'ch0096s-FREE-BLACK',
          selectedOptions: [
            { name: 'Size', value: 'FREE' },
            { name: 'Color', value: 'BLACK' },
          ],
          product: product('2', 'CH0096S', 'DRAFT'),
        },
        {
          id: 'v4',
          title: 'Default Title',
          sku: '',
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          product: product('3', null, 'ARCHIVED'),
        },
        {
          id: 'v5',
          title: 'Default Title',
          sku: 'PRODUCT-8325-FREE-ONECOLOR',
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          product: product('4', 'product-8325', 'ACTIVE'),
        },
        {
          id: 'v6',
          title: 'COTTON',
          sku: 'A-100-FREE-ONECOLOR',
          selectedOptions: [{ name: 'Material', value: 'Cotton' }],
          product: product('5', 'A-100', 'DRAFT'),
        },
        {
          id: 'v7',
          title: 'Default Title',
          sku: 'UN-1-FREE-ONECOLOR',
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          product: product('6', 'UN-1', 'UNLISTED'),
        },
      ],
      '2026-08-02T12:00:00+09:00',
    );
    assertEqual_(audit.summary.productCount, 6);
    assertEqual_(audit.summary.variantCount, 7);
    assertEqual_(audit.summary.activeProductCount, 2);
    assertEqual_(audit.summary.draftProductCount, 2);
    assertEqual_(audit.summary.archivedProductCount, 1);
    assertEqual_(audit.summary.unlistedProductCount, 1);
    assertEqual_(audit.summary.skuBlankCount, 1);
    assertEqual_(audit.summary.skuFormatCount, 1);
    assertEqual_(audit.summary.duplicateSkuCount, 1);
    assertEqual_(audit.summary.productCodeMissingCount, 1);
    assertTrue_(audit.summary.optionIssueCount >= 1);
    const lowercase = audit.rows.filter(function (row) {
      return row.variantId === 'v3';
    })[0];
    assertEqual_(lowercase.productCode, 'CH0096S');
    assertEqual_(lowercase.size, 'FREE');
    assertEqual_(lowercase.color, 'BLACK');
    assertEqual_(lowercase.expectedSku, 'CH0096S-FREE-BLACK');
    assertTrue_(lowercase.issueCodes.indexOf('SKU_FORMAT') >= 0);
    assertTrue_(
      audit.rows[0].issueCodes.indexOf('OPTION_COMBINATION_DUPLICATE') >= 0,
    );
    assertTrue_(
      audit.rows[4].issueCodes.indexOf('PRODUCT_CODE_INTERNAL') >= 0,
    );
    assertTrue_(
      audit.rows[5].issueCodes.indexOf('UNSUPPORTED_OPTION') >= 0,
    );
  }, results);
  test_('SKU audit classifies product, option, and cross-product duplicates', function () {
    const product = function (id, code, vendor) {
      return {
        id: 'product-' + id,
        handle: 'test-' + id,
        vendor: vendor,
        title: 'TEST ' + id,
        status: 'ACTIVE',
        productCode: code === null ? null : { value: code },
      };
    };
    const optionPair = function (size, color) {
      return [
        { name: 'Size', value: size },
        { name: 'Color', value: color },
      ];
    };
    const audit = buildShopifySkuAudit_([
      {
        id: 'missing-1',
        sku: 'TEMP-1-M-BLACK',
        selectedOptions: optionPair('M', 'BLACK'),
        product: product('missing', null, 'SELECT'),
      },
      {
        id: 'missing-2',
        sku: 'TEMP-2-M-BLACK',
        selectedOptions: optionPair('M', 'BLACK'),
        product: product('missing', null, 'SELECT'),
      },
      {
        id: 'cross-1',
        sku: 'SHARED-SKU-FREE',
        selectedOptions: optionPair('S', 'BLACK'),
        product: product('a', 'SAME-CODE', 'BRAND-A'),
      },
      {
        id: 'cross-2',
        sku: 'SHARED-SKU-FREE',
        selectedOptions: optionPair('M', 'WHITE'),
        product: product('b', 'SAME-CODE', 'BRAND-B'),
      },
    ]);
    assertTrue_(
      audit.rows[0].issueCodes.indexOf('OPTION_COMBINATION_DUPLICATE') >= 0,
    );
    assertTrue_(
      audit.rows[1].issueCodes.indexOf('OPTION_COMBINATION_DUPLICATE') >= 0,
    );
    assertTrue_(
      audit.rows[2].issueCodes.indexOf('CROSS_PRODUCT_SKU_DUPLICATE') >= 0,
    );
    assertTrue_(
      audit.rows[3].issueCodes.indexOf('PRODUCT_CODE_DUPLICATE') >= 0,
    );
    assertTrue_(
      audit.rows[3].issueCodes.indexOf('PRODUCT_CODE_BRAND_CONFLICT') >= 0,
    );
    assertEqual_(audit.summary.duplicateSkuCount, 1);
    assertEqual_(audit.summary.duplicateProductCodeCount, 1);
    assertEqual_(audit.summary.productCodeBrandConflictCount, 2);
  }, results);
  test_('missing product codes do not hide duplicate size-color options', function () {
    const product = {
      id: 'product-missing-code',
      handle: 'missing-code',
      vendor: 'SELECT',
      title: 'MISSING CODE',
      status: 'DRAFT',
      productCode: null,
    };
    const selectedOptions = [
      { name: 'Size', value: 'M' },
      { name: 'Color', value: 'BLACK' },
    ];
    const audit = buildShopifySkuAudit_([
      {
        id: 'missing-code-1',
        sku: 'TEMP-1-M-BLACK',
        selectedOptions: selectedOptions,
        product: product,
      },
      {
        id: 'missing-code-2',
        sku: 'TEMP-2-M-BLACK',
        selectedOptions: selectedOptions,
        product: product,
      },
    ]);
    audit.rows.forEach(function (row) {
      assertTrue_(row.issueCodes.indexOf('PRODUCT_CODE_MISSING') >= 0);
      assertTrue_(
        row.issueCodes.indexOf('OPTION_COMBINATION_DUPLICATE') >= 0,
      );
    });
  }, results);
  test_('same current SKU on different products is explicitly cross-product', function () {
    const variant = function (id, productId, code) {
      return {
        id: id,
        sku: 'SAME-CURRENT-SKU',
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
        product: {
          id: productId,
          handle: productId,
          vendor: 'TEST',
          title: productId,
          status: 'ACTIVE',
          productCode: { value: code },
        },
      };
    };
    const audit = buildShopifySkuAudit_([
      variant('cross-current-1', 'product-a', 'CODE-A'),
      variant('cross-current-2', 'product-b', 'CODE-B'),
    ]);
    audit.rows.forEach(function (row) {
      assertTrue_(row.issueCodes.indexOf('SKU_DUPLICATE') >= 0);
      assertTrue_(
        row.issueCodes.indexOf('CROSS_PRODUCT_SKU_DUPLICATE') >= 0,
      );
    });
  }, results);
  test_('duplicate product codes are found even when expected SKUs differ', function () {
    const variant = function (id, productId, vendor, size, color) {
      return {
        id: id,
        sku: 'SHARED-CODE-' + size + '-' + color,
        selectedOptions: [
          { name: 'Size', value: size },
          { name: 'Color', value: color },
        ],
        product: {
          id: productId,
          handle: productId,
          vendor: vendor,
          title: productId,
          status: 'ACTIVE',
          productCode: { value: 'SHARED-CODE' },
        },
      };
    };
    const audit = buildShopifySkuAudit_([
      variant('duplicate-code-1', 'product-a', 'BRAND-A', 'S', 'BLACK'),
      variant('duplicate-code-2', 'product-b', 'BRAND-B', 'M', 'WHITE'),
    ]);
    assertEqual_(audit.summary.duplicateSkuCount, 0);
    assertEqual_(audit.summary.duplicateProductCodeCount, 1);
    audit.rows.forEach(function (row) {
      assertTrue_(row.issueCodes.indexOf('PRODUCT_CODE_DUPLICATE') >= 0);
      assertTrue_(
        row.issueCodes.indexOf('PRODUCT_CODE_BRAND_CONFLICT') >= 0,
      );
    });
  }, results);
  test_('invalid product codes are still checked for cross-product reuse', function () {
    const variant = function (id, productId) {
      return {
        id: id,
        sku: 'TEMP-' + id + '-FREE',
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
        product: {
          id: productId,
          handle: productId,
          vendor: 'TEST',
          title: productId,
          status: 'ARCHIVED',
          productCode: { value: 'INVALID/CODE' },
        },
      };
    };
    const audit = buildShopifySkuAudit_([
      variant('invalid-code-1', 'invalid-product-a'),
      variant('invalid-code-2', 'invalid-product-b'),
    ]);
    assertEqual_(audit.summary.duplicateProductCodeCount, 1);
    audit.rows.forEach(function (row) {
      assertTrue_(row.issueCodes.indexOf('PRODUCT_CODE_INVALID') >= 0);
      assertTrue_(row.issueCodes.indexOf('PRODUCT_CODE_DUPLICATE') >= 0);
    });
  }, results);
  test_('Shopify GraphQL throttling is retried before audit failure', function () {
    const originalGraphql = shopifyGraphql_;
    const originalSleep = shopifySkuThrottleSleep_;
    let calls = 0;
    let sleeps = 0;
    try {
      shopifyGraphql_ = function () {
        calls += 1;
        if (calls < 3) throw new Error('THROTTLED');
        return { productVariants: { nodes: [] } };
      };
      shopifySkuThrottleSleep_ = function () {
        sleeps += 1;
      };
      const page = collectShopifySkuCatalogPage_({}, 'query', {});
      assertTrue_(!!page.productVariants);
      assertEqual_(calls, 3);
      assertEqual_(sleeps, 2);
    } finally {
      shopifyGraphql_ = originalGraphql;
      shopifySkuThrottleSleep_ = originalSleep;
    }
  }, results);
  test_('SKU audit checkpoint validates identity, age, and deadlines', function () {
    const now = Date.parse('2026-08-02T03:00:00.000Z');
    const identity = {
      storeDomain: 'example.myshopify.com',
      apiVersion: '2026-07',
      queryVersion: KEA_SHOPIFY_SKU_QUERY_VERSION,
      checkpointSheetId: '123',
    };
    const state = {
      version: KEA_SHOPIFY_SKU_CHECKPOINT_VERSION,
      storeDomain: identity.storeDomain,
      apiVersion: identity.apiVersion,
      queryVersion: identity.queryVersion,
      checkpointSheetId: identity.checkpointSheetId,
      startedAt: new Date(now - 60000).toISOString(),
      runCount: 1,
      totalVariants: 0,
      partitionVariantCount: 0,
      upperVariantId: '',
      lastVariantId: '',
      after: null,
      idQuery: null,
      complete: false,
    };
    assertEqual_(shopifySkuCheckpointCompatible_(state, identity, now), true);
    assertEqual_(
      shopifySkuCheckpointCompatible_(
        Object.assign({}, state, { storeDomain: 'other.myshopify.com' }),
        identity,
        now,
      ),
      false,
    );
    assertEqual_(
      shopifySkuCheckpointCompatible_(
        Object.assign({}, state, { apiVersion: '2025-10' }),
        identity,
        now,
      ),
      false,
    );
    assertEqual_(
      shopifySkuCheckpointCompatible_(
        Object.assign({}, state, {
          startedAt: new Date(
            now - KEA_SHOPIFY_SKU_CHECKPOINT_TTL_MS - 1,
          ).toISOString(),
        }),
        identity,
        now,
      ),
      false,
    );
    assertEqual_(shopifySkuDeadlineReached_(100000, 15000, 84999), false);
    assertEqual_(shopifySkuDeadlineReached_(100000, 15000, 85000), true);
    assertTrue_(shopifySkuPublishReserveMs_(25001) >= 198000);
    assertEqual_(
      shopifySkuIdRangeQuery_('123', '999'),
      'id:>123 AND id:<=999',
    );
    assertEqual_(
      shopifySkuNumericIdCompare_(
        '9007199254740993',
        '9007199254740992',
      ),
      1,
    );
    assertEqual_(
      validateShopifySkuCatalogPageIds_(
        { lastVariantId: '100', upperVariantId: '300' },
        [
          { id: 'gid://shopify/ProductVariant/101' },
          { id: 'gid://shopify/ProductVariant/250' },
        ],
      ),
      '250',
    );
    let duplicateRejected = false;
    try {
      validateShopifySkuCatalogPageIds_(
        { lastVariantId: '100', upperVariantId: '300' },
        [
          { id: 'gid://shopify/ProductVariant/101' },
          { id: 'gid://shopify/ProductVariant/101' },
        ],
      );
    } catch (error) {
      duplicateRejected = true;
    }
    assertEqual_(duplicateRejected, true);
  }, results);
  test_('SKU audit in-progress checkpoints do not publish partial results', function () {
    const originalCollector = collectShopifySkuCatalog_;
    const originalWriter = writeShopifySkuAudit_;
    let writes = 0;
    try {
      collectShopifySkuCatalog_ = function () {
        return {
          available: true,
          inProgress: true,
          collectionComplete: false,
          checkpointStartedAt: '2026-08-02T12:00:00+09:00',
          checkpointUpdatedAt: '2026-08-02T12:01:00+09:00',
          checkpointRunCount: 2,
          variantsCollected: 1234,
        };
      };
      writeShopifySkuAudit_ = function () {
        writes += 1;
      };
      const collecting = runShopifySkuAuditCore_(
        {},
        Date.now() + KEA_GAS_SAFE_EXECUTION_MS,
      );
      assertEqual_(collecting.inProgress, true);
      assertEqual_(collecting.state, null);
      assertEqual_(collecting.checkpoint.variantsCollected, 1234);
      assertEqual_(collecting.recommendations.length, 0);
      assertEqual_(writes, 0);

      collectShopifySkuCatalog_ = function () {
        return {
          available: true,
          inProgress: false,
          collectionComplete: true,
          checkpointStartedAt: '2026-08-02T12:00:00+09:00',
          checkpointUpdatedAt: '2026-08-02T12:02:00+09:00',
          checkpointRunCount: 3,
          variantsCollected: 1234,
          variants: [],
        };
      };
      const waitingToBuild = runShopifySkuAuditCore_({}, Date.now());
      assertEqual_(waitingToBuild.inProgress, true);
      assertEqual_(waitingToBuild.checkpoint.collectionComplete, true);
      assertEqual_(writes, 0);
    } finally {
      collectShopifySkuCatalog_ = originalCollector;
      writeShopifySkuAudit_ = originalWriter;
    }
  }, results);
  test_('SKU audit sheet escapes formula-like Shopify text', function () {
    assertEqual_(shopifySkuSheetCell_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
    assertEqual_(shopifySkuSheetCell_('2059242-M-BLACK'), '2059242-M-BLACK');
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
  test_('Merchant product increase is detected', function () {
    const events = merchantChangeEvents_(
      {
        totalProducts: 12,
        approved: 0,
        pending: 0,
        disapproved: 7,
        limited: 0,
      },
      {
        totalProducts: 7,
        approved: 0,
        pending: 0,
        disapproved: 7,
        limited: 0,
      },
    );
    assertTrue_(events.some(function (event) {
      return event.indexOf('商品総数 7→12') >= 0;
    }));
  }, results);
  test_('Merchant approval change is detected', function () {
    const events = merchantChangeEvents_(
      {
        totalProducts: 7,
        approved: 3,
        pending: 0,
        disapproved: 4,
        limited: 0,
      },
      {
        totalProducts: 7,
        approved: 0,
        pending: 0,
        disapproved: 7,
        limited: 0,
      },
    );
    assertTrue_(events.some(function (event) {
      return event.indexOf('承認 0→3') >= 0;
    }));
  }, results);
  test_('same Merchant state is not notified again', function () {
    const newItems = healthNewAlertItems_(
      [{ key: 'MERCHANT|same', text: 'same' }],
      ['MERCHANT|same'],
    );
    assertEqual_(newItems.length, 0);
  }, results);
  test_('PENDING_PROCESSING is not an immediate action', function () {
    assertEqual_(
      merchantIssueNeedsAction_({ resolution: 'PENDING_PROCESSING' }),
      false,
    );
  }, results);
  test_('MERCHANT_ACTION is queued for approval', function () {
    assertEqual_(
      merchantIssueNeedsAction_({ resolution: 'MERCHANT_ACTION' }),
      true,
    );
  }, results);
  test_('sitemap errors create a recommendation', function () {
    const items = seoRecommendationsFromAudit_({
      queryRows: [],
      pageRows: [],
      clickChangePct: null,
      sitemap: { errors: 2, warnings: 0 },
      majorUrls: [],
      oldUrls: [],
      oldHttp: [],
    });
    assertTrue_(items.some(function (item) {
      return item.category === 'sitemap';
    }));
  }, results);
  test_('old EC URL is detected', function () {
    assertEqual_(
      isOldKeaUrl_('https://www.kea.co.jp/store/products/list.php'),
      true,
    );
    assertEqual_(isOldKeaUrl_('https://store.kea.co.jp/collections/all'), false);
  }, results);
  test_('low CTR candidate requires meaningful search data', function () {
    assertEqual_(
      seoCtrCandidate_({ impressions: 30, ctr: 0.019, position: 12 }),
      false,
    );
    assertEqual_(
      seoCtrCandidate_({ impressions: 100, ctr: 0.019, position: 12 }),
      true,
    );
    assertEqual_(
      seoCtrCandidate_({ impressions: 100, ctr: 0.02, position: 12 }),
      false,
    );
    assertEqual_(
      seoCtrCandidate_({ impressions: 100, ctr: 0.019, position: 21 }),
      false,
    );
  }, results);
  test_('GBP without location ID is not connected', function () {
    const state = meoConnectionState_('', true, '');
    assertEqual_(state.available, false);
    assertEqual_(state.status, 'needs_setup');
  }, results);
  test_('GBP website difference does not flag confirmed name or address', function () {
    const comparison = compareGbpLocation_({
      title: 'セレクトショップ Kea.',
      storefrontAddress: {
        administrativeArea: '愛知県',
        locality: '名古屋市中区',
        addressLines: ['大須３丁目２−１OS ビル1階'],
      },
      phoneNumbers: { primaryPhone: '052-242-0700' },
      websiteUri: 'https://wrong.example/',
      regularHours: {
        periods: [
          { openDay: 'SUNDAY', openTime: { hours: 11 }, closeTime: { hours: 20 } },
          { openDay: 'MONDAY', openTime: { hours: 11 }, closeTime: { hours: 20 } },
          { openDay: 'THURSDAY', openTime: { hours: 11 }, closeTime: { hours: 20 } },
          { openDay: 'FRIDAY', openTime: { hours: 11 }, closeTime: { hours: 20 } },
          { openDay: 'SATURDAY', openTime: { hours: 11 }, closeTime: { hours: 20 } },
        ],
      },
    });
    assertEqual_(comparison.businessInfoMatches, true);
    assertEqual_(comparison.websiteMatches, false);
    assertEqual_(comparison.differences.length, 1);
    assertTrue_(comparison.differences.some(function (item) {
      return item.field === 'Webサイト';
    }));
  }, results);
  test_('unanswered GBP review is detected', function () {
    const reviews = unansweredGbpReviews_([
      { reviewId: 'new' },
      { reviewId: 'done', reviewReply: { comment: 'thanks' } },
    ]);
    assertEqual_(reviews.length, 1);
    assertEqual_(reviews[0].reviewId, 'new');
  }, results);
  test_('Google My Business review service 403 stays non-blocking', function () {
    const outcome = meoConnectionOutcome_(
      { available: true, value: {}, error: '' },
      { available: true, value: { hasVoiceOfMerchant: true }, error: '' },
      {
        available: false,
        value: { reviews: [] },
        error: 'GBP口コミ: Google My Business API has not been used in project 119772560648 before or it is disabled. HTTP 403',
      },
    );
    assertEqual_(outcome.status, 'connected');
    assertEqual_(outcome.reviewStatus, 'unavailable/pending');
  }, results);
  test_('GBP Performance daily metrics are aggregated', function () {
    const summary = gbpPerformanceSummary_({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
              timeSeries: { datedValues: [{ value: '10' }, { value: '20' }] },
            },
            {
              dailyMetric: 'WEBSITE_CLICKS',
              timeSeries: { datedValues: [{ value: '3' }] },
            },
          ],
        },
      ],
    });
    assertEqual_(summary.businessImpressions, 30);
    assertEqual_(summary.websiteClicks, 3);
    assertEqual_(summary.callClicks, 0);
  }, results);
  test_('verification or unknown review failures remain visible', function () {
    const verificationFailure = meoConnectionOutcome_(
      { available: true, value: {}, error: '' },
      { available: false, value: null, error: 'GBP確認状態: HTTP 403' },
      {
        available: false,
        value: { reviews: [] },
        error: 'GBP口コミ: mybusiness.googleapis.com SERVICE_DISABLED 403',
      },
    );
    assertEqual_(verificationFailure.status, 'partial');
    const unknownReviewFailure = meoConnectionOutcome_(
      { available: true, value: {}, error: '' },
      { available: true, value: { hasVoiceOfMerchant: true }, error: '' },
      {
        available: false,
        value: { reviews: [] },
        error: 'GBP口コミ: HTTP 500',
      },
    );
    assertEqual_(unknownReviewFailure.status, 'partial');
    assertEqual_(unknownReviewFailure.reviewStatus, 'unavailable');
    const performanceFailure = meoConnectionOutcome_(
      { available: true, value: {}, error: '' },
      { available: true, value: { hasVoiceOfMerchant: true }, error: '' },
      { available: true, value: { reviews: [] }, error: '' },
      {
        available: false,
        value: { metrics: {} },
        error: 'GBP Performance: HTTP 403',
      },
    );
    assertEqual_(performanceFailure.status, 'partial');
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
