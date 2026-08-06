const KEA_SALE_MAX_PRODUCTS = 100;
const KEA_SALE_MAX_VARIANTS = 100;
const KEA_SALE_QUERY_BATCH = 8;

/** 公開中の商品をSALE一括設定画面へ返す。 */
function getSaleProductCatalog() {
  const config = keaConfig_();
  const products = [];
  let cursor = null;
  do {
    const data = shopifyGraphql_(
      config,
      `query KeaSaleCatalog($cursor: String) {
        products(first: 100, after: $cursor, query: "status:active", sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle vendor status isGiftCard
            productCode: metafield(namespace: "custom", key: "product_code") { value }
            variantsCount { count }
            priceRangeV2 {
              minVariantPrice { amount }
              maxVariantPrice { amount }
            }
            compareAtPriceRange {
              minVariantCompareAtPrice { amount }
              maxVariantCompareAtPrice { amount }
            }
          }
        }
      }`,
      { cursor: cursor },
      'Shopify SALE商品一覧',
    );
    const connection = (data && data.products) || {};
    (connection.nodes || []).forEach(function (product) {
      if (!product || product.isGiftCard) return;
      const priceRange = product.priceRangeV2 || {};
      const compareRange = product.compareAtPriceRange || {};
      const compareMax = saleMoneyV2_(compareRange.maxVariantCompareAtPrice);
      products.push({
        id: product.id,
        title: product.title || '',
        handle: product.handle || '',
        vendor: product.vendor || '',
        productCode: product.productCode && product.productCode.value
          ? String(product.productCode.value).trim()
          : '',
        variantCount: Number(product.variantsCount && product.variantsCount.count || 0),
        onSale: compareMax !== null && compareMax > 0,
        priceMin: saleMoneyV2_(priceRange.minVariantPrice),
        priceMax: saleMoneyV2_(priceRange.maxVariantPrice),
        compareAtMin: compareMax > 0
          ? saleMoneyV2_(compareRange.minVariantCompareAtPrice)
          : null,
        compareAtMax: compareMax > 0 ? compareMax : null,
        searchText: [
          product.title,
          product.handle,
          product.vendor,
          product.productCode && product.productCode.value,
        ].join(' ').toLowerCase(),
      });
    });
    cursor = connection.pageInfo && connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (cursor);
  return {
    generatedAt: isoTimestamp_(new Date()),
    productCount: products.length,
    products: products,
  };
}

/** 同じ割引率を選択商品へ一括適用、またはSALEを終了する。 */
function applySaleBulk(request) {
  const result = withScriptLock_('applySaleBulk', function () {
    return applySaleBulkLocked_(request);
  });
  if (result && result.status === 'skipped') {
    throw new Error('別の処理が実行中です。少し置いて再実行してください。');
  }
  return result;
}

function applySaleBulkLocked_(request) {
  const input = validateSaleBulkRequest_(request);
  const config = keaConfig_();
  const products = fetchSaleProductsByIds_(config, input.productIds);
  const plan = buildSaleBulkPlan_(products, input.mode, input.discountPercent);
  const changed = plan.products.filter(function (product) {
    return product.variants.length > 0;
  });
  if (!changed.length) {
    return {
      status: 'unchanged',
      mode: input.mode,
      discountPercent: input.discountPercent,
      productCount: 0,
      variantCount: 0,
      message: input.mode === 'END'
        ? '終了対象のSALE商品はありません。'
        : '選択商品は既に同じSALE価格です。',
    };
  }

  const operationId = Utilities.getUuid();
  const actor = saleActorEmail_();
  appendSaleHistoryRows_(saleHistoryRows_(
    operationId,
    isoTimestamp_(new Date()),
    actor,
    input,
    changed,
    'BACKUP',
    '更新前バックアップ',
  ));

  const applied = [];
  try {
    changed.forEach(function (product) {
      try {
        updateSaleProductVariants_(config, product, false);
      } catch (error) {
        if (error && error.saleMutationCompleted === true) {
          try {
            updateSaleProductVariants_(config, product, true);
            appendSaleHistoryRows_(saleHistoryRows_(
              operationId,
              isoTimestamp_(new Date()),
              actor,
              input,
              [product],
              'ROLLED_BACK',
              '検証失敗のため復元',
            ));
          } catch (rollbackError) {
            error.saleCurrentRollbackError = String(
              rollbackError && rollbackError.message || rollbackError,
            );
          }
        }
        throw error;
      }
      applied.push(product);
      appendSaleHistoryRows_(saleHistoryRows_(
        operationId,
        isoTimestamp_(new Date()),
        actor,
        input,
        [product],
        'APPLIED',
        'Shopify反映・検証済み',
      ));
    });
  } catch (error) {
    const rollbackErrors = rollbackSaleProducts_(
      config,
      applied,
      operationId,
      actor,
      input,
    );
    if (error && error.saleCurrentRollbackError) {
      rollbackErrors.unshift(error.saleCurrentRollbackError);
    }
    throw new Error(
      'SALE一括更新に失敗しました: ' +
      String(error && error.message || error) +
      ' / ' +
      (rollbackErrors.length
        ? '復元失敗: ' + rollbackErrors.join(' | ')
        : '反映済み商品は元の価格へ戻しました。'),
    );
  }

  return {
    status: 'success',
    operationId: operationId,
    mode: input.mode,
    discountPercent: input.discountPercent,
    productCount: changed.length,
    variantCount: changed.reduce(function (total, product) {
      return total + product.variants.length;
    }, 0),
    message: input.mode === 'END'
      ? '選択商品のSALEを終了しました。'
      : input.discountPercent + '%OFFを反映しました。',
  };
}

function validateSaleBulkRequest_(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('入力内容がありません。');
  }
  const mode = String(request.mode || 'APPLY').toUpperCase();
  if (mode !== 'APPLY' && mode !== 'END') {
    throw new Error('処理区分が不正です。');
  }
  const seen = {};
  const productIds = (Array.isArray(request.productIds) ? request.productIds : [])
    .map(function (value) { return String(value || '').trim(); })
    .filter(function (value) {
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(value) || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  if (!productIds.length) throw new Error('商品を1点以上選択してください。');
  if (productIds.length > KEA_SALE_MAX_PRODUCTS) {
    throw new Error('1回に選択できる商品は100点までです。');
  }
  let discountPercent = null;
  if (mode === 'APPLY') {
    discountPercent = Number(request.discountPercent);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 99) {
      throw new Error('割引率は1〜99の整数で入力してください。');
    }
  }
  return {
    mode: mode,
    discountPercent: discountPercent,
    productIds: productIds,
  };
}
