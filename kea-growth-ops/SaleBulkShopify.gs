function fetchSaleProductsByIds_(config, productIds) {
  const found = {};
  saleChunks_(productIds, KEA_SALE_QUERY_BATCH).forEach(function (ids) {
    const data = shopifyGraphql_(
      config,
      `query KeaSaleProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id title status isGiftCard
            productCode: metafield(namespace: "custom", key: "product_code") { value }
            variantsCount { count }
            variants(first: 100) {
              nodes { id title sku price compareAtPrice }
            }
          }
        }
      }`,
      { ids: ids },
      'Shopify SALE対象商品取得',
    );
    (data.nodes || []).forEach(function (product) {
      if (product && product.id) found[product.id] = product;
    });
  });

  const missing = productIds.filter(function (id) { return !found[id]; });
  if (missing.length) throw new Error('取得できない商品が含まれています。');
  return productIds.map(function (id) {
    const product = found[id];
    if (product.isGiftCard) {
      throw new Error((product.title || id) + 'はギフトカードのため対象外です。');
    }
    if (String(product.status || '').toUpperCase() !== 'ACTIVE') {
      throw new Error((product.title || id) + 'は公開中商品ではありません。');
    }
    const count = Number(product.variantsCount && product.variantsCount.count || 0);
    const variants = product.variants && product.variants.nodes || [];
    if (!variants.length) throw new Error((product.title || id) + 'にバリエーションがありません。');
    if (count > KEA_SALE_MAX_VARIANTS || count !== variants.length) {
      throw new Error((product.title || id) + 'のバリエーション数が安全上限を超えています。');
    }
    return product;
  });
}

function buildSaleBulkPlan_(products, mode, discountPercent) {
  return {
    products: products.map(function (product) {
      const variants = [];
      (product.variants && product.variants.nodes || []).forEach(function (variant) {
        const previousPrice = saleMoney_(variant.price, '価格');
        const previousCompare = saleNullableMoney_(variant.compareAtPrice, '割引前価格');
        if (previousCompare !== null && previousCompare <= previousPrice) {
          throw new Error(saleVariantLabel_(product, variant) +
            'の割引前価格が価格以下です。先に価格を修正してください。');
        }
        let nextPrice = previousPrice;
        let nextCompare = previousCompare;
        if (mode === 'APPLY') {
          const base = previousCompare !== null ? previousCompare : previousPrice;
          nextPrice = salePriceFromPercent_(base, discountPercent);
          nextCompare = base;
          if (nextPrice <= 0 || nextPrice >= nextCompare) {
            throw new Error(saleVariantLabel_(product, variant) +
              'のSALE価格を安全に計算できませんでした。');
          }
        } else if (previousCompare !== null) {
          nextPrice = previousCompare;
          nextCompare = null;
        }
        if (saleMoneyEquals_(previousPrice, nextPrice) &&
            saleNullableMoneyEquals_(previousCompare, nextCompare)) return;
        variants.push({
          id: variant.id,
          title: variant.title || '',
          sku: variant.sku || '',
          previousPrice: previousPrice,
          previousCompareAtPrice: previousCompare,
          nextPrice: nextPrice,
          nextCompareAtPrice: nextCompare,
        });
      });
      return {
        id: product.id,
        title: product.title || '',
        productCode: product.productCode && product.productCode.value
          ? String(product.productCode.value).trim()
          : '',
        variants: variants,
      };
    }),
  };
}

function updateSaleProductVariants_(config, product, rollback) {
  const variants = product.variants.map(function (variant) {
    return {
      id: variant.id,
      price: saleMoneyInput_(rollback ? variant.previousPrice : variant.nextPrice),
      compareAtPrice: saleNullableMoneyInput_(rollback
        ? variant.previousCompareAtPrice
        : variant.nextCompareAtPrice),
    };
  });
  let data;
  try {
    data = shopifyGraphql_(
      config,
      `mutation KeaSaleBulkUpdate(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(
          productId: $productId
          variants: $variants
          allowPartialUpdates: false
        ) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }`,
      { productId: product.id, variants: variants },
      rollback ? 'Shopify SALE復元' : 'Shopify SALE一括更新',
    );
  } catch (error) {
    const message = String(error && error.message || error);
    if (/write_products|access denied|permission/i.test(message)) {
      throw new Error(
        'Shopify連携に商品編集権限（write_products）がありません。' +
        'Kea. Growth OpsのShopifyアプリへ権限を追加してください。',
      );
    }
    throw error;
  }

  const payload = data.productVariantsBulkUpdate || {};
  const userErrors = payload.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors.map(function (error) {
      return error.message || 'Shopify更新エラー';
    }).join(' | '));
  }
  const expected = {};
  product.variants.forEach(function (variant) {
    expected[variant.id] = {
      price: rollback ? variant.previousPrice : variant.nextPrice,
      compareAtPrice: rollback
        ? variant.previousCompareAtPrice
        : variant.nextCompareAtPrice,
    };
  });
  const returned = payload.productVariants || [];
  if (returned.length !== product.variants.length) {
    throw saleMutationError_(product.title + 'の更新件数が一致しません。');
  }
  returned.forEach(function (variant) {
    const target = expected[variant.id];
    if (!target ||
        !saleMoneyEquals_(saleMoney_(variant.price), target.price) ||
        !saleNullableMoneyEquals_(
          saleNullableMoney_(variant.compareAtPrice),
          target.compareAtPrice,
        )) {
      throw saleMutationError_(product.title + 'の価格検証に失敗しました。');
    }
  });
}

function saleMutationError_(message) {
  const error = new Error(message);
  error.saleMutationCompleted = true;
  return error;
}

function rollbackSaleProducts_(config, applied, operationId, actor, input) {
  const errors = [];
  applied.slice().reverse().forEach(function (product) {
    try {
      updateSaleProductVariants_(config, product, true);
      appendSaleHistoryRows_(saleHistoryRows_(
        operationId,
        isoTimestamp_(new Date()),
        actor,
        input,
        [product],
        'ROLLED_BACK',
        '更新失敗のため復元',
      ));
    } catch (error) {
      const message = product.title + ': ' + String(error && error.message || error);
      errors.push(message);
      appendSaleHistoryRows_(saleHistoryRows_(
        operationId,
        isoTimestamp_(new Date()),
        actor,
        input,
        [product],
        'ROLLBACK_FAILED',
        message,
      ));
    }
  });
  return errors;
}
