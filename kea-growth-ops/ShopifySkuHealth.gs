const KEA_SHOPIFY_SKU_AUDIT_SHEET = 'ShopifySkuAudit';
const KEA_SHOPIFY_SKU_CHECKPOINT_SHEET = '_ShopifySkuAuditCheckpoint';
const KEA_SHOPIFY_SKU_CHECKPOINT_KEY = 'KEA_SHOPIFY_SKU_CHECKPOINT_V3';
const KEA_SHOPIFY_SKU_LIVE_ROW_COUNT_KEY =
  'KEA_SHOPIFY_SKU_LIVE_ROW_COUNT';
const KEA_SHOPIFY_SKU_STAGING_SHEET = '_ShopifySkuAuditStaging';
const KEA_SHOPIFY_SKU_BACKUP_SHEET = '_ShopifySkuAuditBackup';
const KEA_SHOPIFY_SKU_PUBLISH_WAL_KEY =
  'KEA_SHOPIFY_SKU_PUBLISH_WAL_V1';
const KEA_SHOPIFY_SKU_CHECKPOINT_VERSION = 3;
const KEA_SHOPIFY_SKU_QUERY_VERSION =
  'product-variant-id-range-snapshot-v3';
const KEA_SHOPIFY_SKU_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEA_SHOPIFY_SKU_COLLECTION_BUDGET_MS = 150000;
const KEA_SHOPIFY_SKU_FINALIZE_RESERVE_MS = 90000;
const KEA_SHOPIFY_SKU_BUILD_RESERVE_MS = 60000;
const KEA_SHOPIFY_SKU_PUBLISH_RESERVE_MS = 45000;
const KEA_SHOPIFY_SKU_API_RESERVE_MS = 15000;
const KEA_GAS_SAFE_EXECUTION_MS = 330000;
const KEA_HEALTH_POST_SKU_RESERVE_MS = 30000;

const KEA_SKU_EXPECTED_VENDOR_BY_PRODUCT_CODE = Object.freeze({
  CH0096S: 'Chloé',
});

const KEA_SKU_ISSUE_LABELS = Object.freeze({
  PRODUCT_CODE_MISSING: '商品コード欠落',
  PRODUCT_CODE_INTERNAL: '商品コードが内部管理値',
  PRODUCT_CODE_INVALID: '商品コード形式異常',
  PRODUCT_CODE_NORMALIZATION: '商品コードの正規化が必要',
  OPTION_DATA_INVALID: 'optionデータ異常',
  OPTION_NAME_MISSING: 'option名欠落',
  UNSUPPORTED_OPTION: '未対応optionあり',
  SIZE_OPTION_DUPLICATE: 'サイズoption重複',
  SIZE_OPTION_VALUE_MISSING: 'サイズoption値欠落',
  SIZE_OPTION_VALUE_INVALID: 'サイズoption値異常',
  COLOR_OPTION_DUPLICATE: 'カラーoption重複',
  COLOR_OPTION_VALUE_MISSING: 'カラーoption値欠落',
  COLOR_OPTION_VALUE_INVALID: 'カラーoption値異常',
  SKU_BLANK: 'SKU空欄',
  SKU_FORMAT: 'SKU形式違反',
  SKU_DUPLICATE: 'SKU重複',
  PRODUCT_CODE_DUPLICATE: '別商品間の商品コード重複',
  PRODUCT_CODE_BRAND_CONFLICT: '商品コードとブランドの組み合わせ異常',
  PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH: '既知商品コードの期待ブランド不一致',
  OPTION_COMBINATION_DUPLICATE: '同一商品内のサイズ・カラー重複',
  CROSS_PRODUCT_SKU_DUPLICATE: '別商品間のSKU重複',
});

function skuNfkc_(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
}

function normalizeSkuPart_(value) {
  return skuNfkc_(value)
    .trim()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, '-')
    .toUpperCase();
}

function validSkuPart_(value) {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(String(value || ''));
}

function buildExpectedSku_(productCode, size, color) {
  const normalizedProductCode = normalizeSkuPart_(productCode);
  const normalizedSize = normalizeSkuPart_(size);
  const normalizedColor = normalizeSkuPart_(color);
  if (
    !validSkuPart_(normalizedProductCode) ||
    !validSkuPart_(normalizedSize) ||
    !validSkuPart_(normalizedColor)
  ) {
    return '';
  }
  return [normalizedProductCode, normalizedSize, normalizedColor].join('-');
}

function skuIssueLabel_(code) {
  return KEA_SKU_ISSUE_LABELS[code] || code;
}

function addSkuIssue_(row, code) {
  if (row.issueCodes.indexOf(code) < 0) row.issueCodes.push(code);
}

function normalizedOptionName_(value) {
  return skuNfkc_(value)
    .trim()
    .replace(/[\s_-]+/g, '')
    .toUpperCase();
}

function normalizedSkuVendor_(value) {
  return skuNfkc_(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

function expectedSkuVendor_(productCode) {
  return KEA_SKU_EXPECTED_VENDOR_BY_PRODUCT_CODE[
    normalizeSkuPart_(productCode)
  ] || '';
}

function productCodeIdentity_(product) {
  const metafield = product && product.productCode;
  const raw = String(metafield && metafield.value || '');
  const rawTrimmed = raw.trim();
  const trimmed = skuNfkc_(raw).trim();
  const normalized = normalizeSkuPart_(raw);
  const issues = [];
  if (!trimmed) {
    issues.push('PRODUCT_CODE_MISSING');
  } else {
    if (
      /^GID:\/\/SHOPIFY\//i.test(trimmed) ||
      /^(PRODUCT|VARIANT)-\d+$/i.test(normalized)
    ) {
      issues.push('PRODUCT_CODE_INTERNAL');
    }
    if (!validSkuPart_(normalized)) {
      issues.push('PRODUCT_CODE_INVALID');
    }
    if (rawTrimmed !== normalized) {
      issues.push('PRODUCT_CODE_NORMALIZATION');
    }
  }
  return {
    raw: raw,
    normalized: normalized,
    issues: issues,
    valid:
      issues.indexOf('PRODUCT_CODE_MISSING') < 0 &&
      issues.indexOf('PRODUCT_CODE_INTERNAL') < 0 &&
      issues.indexOf('PRODUCT_CODE_INVALID') < 0,
  };
}

function resolveSkuSelectedOptions_(selectedOptions) {
  const issues = [];
  const sizeValues = [];
  const colorValues = [];
  let sizeOptionCount = 0;
  let colorOptionCount = 0;

  if (!Array.isArray(selectedOptions)) {
    return {
      size: '',
      color: '',
      issues: ['OPTION_DATA_INVALID'],
      valid: false,
    };
  }

  selectedOptions.forEach(function (option) {
    const rawName = String(option && option.name || '');
    const rawValue = String(option && option.value || '');
    const name = normalizedOptionName_(rawName);
    const defaultValue = normalizedOptionName_(rawValue);

    if (!name) {
      issues.push('OPTION_NAME_MISSING');
      return;
    }
    if (name === 'TITLE' && defaultValue === 'DEFAULTTITLE') return;

    if (
      name === 'SIZE' ||
      name === 'SIZEDETAIL' ||
      name === 'サイズ' ||
      name === 'サイズ詳細' ||
      name === '実寸サイズ'
    ) {
      sizeOptionCount += 1;
      if (!skuNfkc_(rawValue).trim()) {
        issues.push('SIZE_OPTION_VALUE_MISSING');
        return;
      }
      const value = normalizeSkuPart_(rawValue);
      sizeValues.push(value);
      if (!validSkuPart_(value)) issues.push('SIZE_OPTION_VALUE_INVALID');
      return;
    }

    if (
      name === 'COLOR' ||
      name === 'COLOUR' ||
      name === 'カラー'
    ) {
      colorOptionCount += 1;
      if (!skuNfkc_(rawValue).trim()) {
        issues.push('COLOR_OPTION_VALUE_MISSING');
        return;
      }
      const value = normalizeSkuPart_(rawValue);
      colorValues.push(value);
      if (!validSkuPart_(value)) issues.push('COLOR_OPTION_VALUE_INVALID');
      return;
    }

    issues.push('UNSUPPORTED_OPTION');
  });

  if (sizeOptionCount > 1) issues.push('SIZE_OPTION_DUPLICATE');
  if (colorOptionCount > 1) issues.push('COLOR_OPTION_DUPLICATE');

  const uniqueIssues = [];
  issues.forEach(function (issue) {
    if (uniqueIssues.indexOf(issue) < 0) uniqueIssues.push(issue);
  });
  return {
    size:
      sizeOptionCount === 0
        ? 'FREE'
        : sizeValues.length
          ? sizeValues[0]
          : '',
    color:
      colorOptionCount === 0
        ? 'ONECOLOR'
        : colorValues.length
          ? colorValues[0]
          : '',
    issues: uniqueIssues,
    valid: uniqueIssues.length === 0,
  };
}

function genericSkuFormatValid_(sku) {
  const raw = String(sku || '');
  const normalized = normalizeSkuPart_(raw);
  const hyphens = (normalized.match(/-/g) || []).length;
  return raw === normalized && validSkuPart_(normalized) && hyphens >= 2;
}

function buildShopifySkuAudit_(variants, checkedAt) {
  const timestamp = checkedAt || isoTimestamp_(new Date());
  const rows = (variants || []).map(function (variant) {
    const product = variant && variant.product || {};
    const productCode = productCodeIdentity_(product);
    const options = resolveSkuSelectedOptions_(variant && variant.selectedOptions);
    const currentSku = String(variant && variant.sku || '');
    const expectedSku =
      productCode.valid && options.valid
        ? buildExpectedSku_(productCode.normalized, options.size, options.color)
        : '';
    const row = {
      checkedAt: timestamp,
      connectionStatus: 'connected',
      productId: String(product.id || ''),
      variantId: String(variant && variant.id || ''),
      handle: String(product.handle || ''),
      vendor: String(product.vendor || ''),
      title: String(product.title || ''),
      productStatus: String(product.status || ''),
      publishedAt: String(product.publishedAt || ''),
      variantTitle: String(variant && variant.title || ''),
      rawProductCode: productCode.raw,
      productCode: productCode.normalized,
      size: options.size,
      color: options.color,
      currentSku: currentSku,
      expectedSku: expectedSku,
      auditStatus: '',
      issueCodes: [],
      selectedOptions: JSON.stringify(
        variant && Array.isArray(variant.selectedOptions)
          ? variant.selectedOptions
          : [],
      ),
    };
    productCode.issues.forEach(function (issue) {
      addSkuIssue_(row, issue);
    });
    options.issues.forEach(function (issue) {
      addSkuIssue_(row, issue);
    });
    const expectedVendor = expectedSkuVendor_(row.productCode);
    if (
      expectedVendor &&
      normalizedSkuVendor_(row.vendor) !== normalizedSkuVendor_(expectedVendor)
    ) {
      addSkuIssue_(row, 'PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH');
    }
    if (!currentSku.trim()) {
      addSkuIssue_(row, 'SKU_BLANK');
    } else if (
      (expectedSku && currentSku !== expectedSku) ||
      (!expectedSku && !genericSkuFormatValid_(currentSku))
    ) {
      addSkuIssue_(row, 'SKU_FORMAT');
    }
    return row;
  });

  const currentSkuIndexes = Object.create(null);
  const expectedSkuIndexes = Object.create(null);
  const optionCombinationIndexes = Object.create(null);
  const productCodeIndexes = Object.create(null);
  rows.forEach(function (row, index) {
    const currentKey = normalizeSkuPart_(row.currentSku);
    if (currentKey) {
      if (!currentSkuIndexes['$' + currentKey]) {
        currentSkuIndexes['$' + currentKey] = [];
      }
      currentSkuIndexes['$' + currentKey].push(index);
    }
    if (row.expectedSku) {
      if (!expectedSkuIndexes['$' + row.expectedSku]) {
        expectedSkuIndexes['$' + row.expectedSku] = [];
      }
      expectedSkuIndexes['$' + row.expectedSku].push(index);
    }
    if (row.productId && row.size && row.color) {
      const optionKey = '$' + JSON.stringify([
        row.productId,
        row.size,
        row.color,
      ]);
      if (!optionCombinationIndexes[optionKey]) {
        optionCombinationIndexes[optionKey] = [];
      }
      optionCombinationIndexes[optionKey].push(index);
    }
    if (row.productId && row.productCode) {
      const productCodeKey = '$' + row.productCode;
      if (!productCodeIndexes[productCodeKey]) {
        productCodeIndexes[productCodeKey] = [];
      }
      productCodeIndexes[productCodeKey].push(index);
    }
  });

  const duplicateValues = Object.create(null);
  const duplicateProductCodeValues = Object.create(null);
  Object.keys(currentSkuIndexes).forEach(function (key) {
    const indexes = currentSkuIndexes[key];
    if (indexes.length < 2) return;
    duplicateValues[key] = true;
    const productIds = Object.create(null);
    indexes.forEach(function (index) {
      productIds[rows[index].productId] = true;
      addSkuIssue_(rows[index], 'SKU_DUPLICATE');
    });
    if (Object.keys(productIds).length > 1) {
      indexes.forEach(function (index) {
        addSkuIssue_(rows[index], 'CROSS_PRODUCT_SKU_DUPLICATE');
      });
    }
  });
  Object.keys(expectedSkuIndexes).forEach(function (key) {
    const indexes = expectedSkuIndexes[key];
    if (indexes.length < 2) return;
    duplicateValues[key] = true;
    const productIds = {};
    indexes.forEach(function (index) {
      productIds[rows[index].productId] = true;
      addSkuIssue_(rows[index], 'SKU_DUPLICATE');
    });
    const duplicateType =
      Object.keys(productIds).length === 1
        ? 'OPTION_COMBINATION_DUPLICATE'
        : 'CROSS_PRODUCT_SKU_DUPLICATE';
    indexes.forEach(function (index) {
      addSkuIssue_(rows[index], duplicateType);
    });
  });
  Object.keys(optionCombinationIndexes).forEach(function (key) {
    const indexes = optionCombinationIndexes[key];
    if (indexes.length < 2) return;
    indexes.forEach(function (index) {
      addSkuIssue_(rows[index], 'OPTION_COMBINATION_DUPLICATE');
    });
  });
  Object.keys(productCodeIndexes).forEach(function (key) {
    const indexes = productCodeIndexes[key];
    const productIds = Object.create(null);
    const vendors = Object.create(null);
    indexes.forEach(function (index) {
      productIds[rows[index].productId] = true;
      vendors['$' + normalizeSkuPart_(rows[index].vendor)] = true;
    });
    if (Object.keys(productIds).length < 2) return;
    duplicateProductCodeValues[key] = true;
    indexes.forEach(function (index) {
      addSkuIssue_(rows[index], 'PRODUCT_CODE_DUPLICATE');
      if (Object.keys(vendors).length > 1) {
        addSkuIssue_(rows[index], 'PRODUCT_CODE_BRAND_CONFLICT');
      }
    });
  });

  const productStates = Object.create(null);
  rows.forEach(function (row) {
    if (row.productId && !productStates[row.productId]) {
      productStates[row.productId] = row.productStatus;
    }
    row.auditStatus = row.issueCodes.length ? '要確認' : 'OK';
  });

  const hasAnyIssue_ = function (row, codes) {
    return codes.some(function (code) {
      return row.issueCodes.indexOf(code) >= 0;
    });
  };
  const productCodeIssueCodes = [
    'PRODUCT_CODE_INTERNAL',
    'PRODUCT_CODE_INVALID',
    'PRODUCT_CODE_NORMALIZATION',
    'PRODUCT_CODE_DUPLICATE',
    'PRODUCT_CODE_BRAND_CONFLICT',
    'PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH',
  ];
  const optionIssueCodes = [
    'OPTION_DATA_INVALID',
    'OPTION_NAME_MISSING',
    'UNSUPPORTED_OPTION',
    'SIZE_OPTION_DUPLICATE',
    'SIZE_OPTION_VALUE_MISSING',
    'SIZE_OPTION_VALUE_INVALID',
    'COLOR_OPTION_DUPLICATE',
    'COLOR_OPTION_VALUE_MISSING',
    'COLOR_OPTION_VALUE_INVALID',
    'OPTION_COMBINATION_DUPLICATE',
  ];
  const statuses = { ACTIVE: 0, DRAFT: 0, ARCHIVED: 0, UNLISTED: 0 };
  Object.keys(productStates).forEach(function (productId) {
    const status = String(productStates[productId] || '');
    if (statuses[status] !== undefined) statuses[status] += 1;
  });

  return {
    rows: rows,
    summary: {
      productCount: Object.keys(productStates).length,
      variantCount: rows.length,
      activeProductCount: statuses.ACTIVE,
      draftProductCount: statuses.DRAFT,
      archivedProductCount: statuses.ARCHIVED,
      unlistedProductCount: statuses.UNLISTED,
      okVariantCount: rows.filter(function (row) {
        return row.auditStatus === 'OK';
      }).length,
      issueVariantCount: rows.filter(function (row) {
        return row.auditStatus !== 'OK';
      }).length,
      skuBlankCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('SKU_BLANK') >= 0;
      }).length,
      skuFormatCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('SKU_FORMAT') >= 0;
      }).length,
      duplicateSkuCount: Object.keys(duplicateValues).length,
      duplicateVariantCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('SKU_DUPLICATE') >= 0;
      }).length,
      duplicateProductCodeCount: Object.keys(
        duplicateProductCodeValues,
      ).length,
      productCodeDuplicateVariantCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('PRODUCT_CODE_DUPLICATE') >= 0;
      }).length,
      productCodeBrandConflictCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('PRODUCT_CODE_BRAND_CONFLICT') >= 0;
      }).length,
      expectedVendorMismatchCount: rows.filter(function (row) {
        return row.issueCodes.indexOf(
          'PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH',
        ) >= 0;
      }).length,
      productCodeMissingCount: rows.filter(function (row) {
        return row.issueCodes.indexOf('PRODUCT_CODE_MISSING') >= 0;
      }).length,
      productCodeIssueCount: rows.filter(function (row) {
        return hasAnyIssue_(row, productCodeIssueCodes);
      }).length,
      optionIssueCount: rows.filter(function (row) {
        return hasAnyIssue_(row, optionIssueCodes);
      }).length,
    },
  };
}

function shopifySkuSheetCell_(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function shopifySkuSheetRows_(audit) {
  return audit.rows.map(function (row) {
    return [
      row.checkedAt,
      row.connectionStatus,
      row.productId,
      row.variantId,
      row.handle,
      row.vendor,
      row.title,
      row.productStatus,
      row.publishedAt,
      row.variantTitle,
      row.rawProductCode,
      row.productCode,
      row.size,
      row.color,
      row.currentSku,
      row.expectedSku,
      row.auditStatus,
      row.issueCodes.map(skuIssueLabel_).join(' / '),
      row.selectedOptions,
    ].map(shopifySkuSheetCell_);
  });
}

function ensureShopifySkuSheetSize_(sheet, rowCount, columnCount) {
  if (sheet.getMaxRows() < rowCount) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowCount - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < columnCount) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      columnCount - sheet.getMaxColumns(),
    );
  }
}

function shopifySkuDeadlineReached_(deadlineAtMs, reserveMs, nowMs) {
  const deadline = Number(deadlineAtMs || 0);
  if (!deadline) return false;
  const now = Number(nowMs === undefined ? Date.now() : nowMs);
  return now + Number(reserveMs || 0) >= deadline;
}

function shopifySkuIdRangeQuery_(lowerExclusive, upperInclusive) {
  const lower = String(lowerExclusive || '').trim();
  const upper = String(upperInclusive || '').trim();
  if ((lower && !/^\d+$/.test(lower)) || !/^\d+$/.test(upper)) {
    throw new Error('Shopify SKU checkpointのvariant ID範囲が不正です。');
  }
  return (lower ? 'id:>' + lower + ' AND ' : '') + 'id:<=' + upper;
}

function shopifySkuNumericIdCompare_(left, right) {
  const normalize = function (value) {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) {
      throw new Error('Shopify variant IDが数値ではありません。');
    }
    return text.replace(/^0+(?=\d)/, '');
  };
  const a = normalize(left);
  const b = normalize(right);
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function shopifySkuTimeBudgetError_() {
  const error = new Error('Shopify SKU audit time budget checkpoint');
  error.shopifySkuTimeBudget = true;
  return error;
}

function isShopifySkuTimeBudgetError_(error) {
  return !!(error && error.shopifySkuTimeBudget);
}

function readShopifySkuCheckpointState_() {
  const text = PropertiesService.getScriptProperties().getProperty(
    KEA_SHOPIFY_SKU_CHECKPOINT_KEY,
  );
  if (!text) return null;
  try {
    const state = JSON.parse(text);
    return state && state.version === KEA_SHOPIFY_SKU_CHECKPOINT_VERSION
      ? state
      : null;
  } catch (error) {
    return null;
  }
}

function writeShopifySkuCheckpointState_(state) {
  PropertiesService.getScriptProperties().setProperty(
    KEA_SHOPIFY_SKU_CHECKPOINT_KEY,
    JSON.stringify(state),
  );
}

function getShopifySkuCheckpointSheet_() {
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(KEA_SHOPIFY_SKU_CHECKPOINT_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(KEA_SHOPIFY_SKU_CHECKPOINT_SHEET);
  }
  try {
    sheet.hideSheet();
  } catch (error) {
    console.error(
      'Shopify SKU checkpoint hide: ' +
        String(error && error.message || error),
    );
  }
  return sheet;
}

function shopifySkuCheckpointCompatible_(state, identity, nowMs) {
  if (!state || !identity) return false;
  if (state.version !== KEA_SHOPIFY_SKU_CHECKPOINT_VERSION) return false;
  const startedAtMs = Date.parse(String(state.startedAt || ''));
  if (!Number.isFinite(startedAtMs)) return false;
  if (
    Number(nowMs === undefined ? Date.now() : nowMs) - startedAtMs >
    KEA_SHOPIFY_SKU_CHECKPOINT_TTL_MS
  ) {
    return false;
  }
  const totalVariants = Number(state.totalVariants);
  const partitionVariantCount = Number(state.partitionVariantCount);
  const runCount = Number(state.runCount);
  const upperVariantId = String(state.upperVariantId || '');
  const lastVariantId = String(state.lastVariantId || '');
  const validCounts =
    Number.isInteger(totalVariants) &&
    totalVariants >= 0 &&
    Number.isInteger(partitionVariantCount) &&
    partitionVariantCount >= 0 &&
    Number.isInteger(runCount) &&
    runCount >= 1;
  const validIds =
    (upperVariantId === '' || /^\d+$/.test(upperVariantId)) &&
    (lastVariantId === '' || /^\d+$/.test(lastVariantId)) &&
    (totalVariants === 0 || !!lastVariantId) &&
    (!lastVariantId || !!upperVariantId);
  const validCursor =
    (state.after === null || typeof state.after === 'string') &&
    (state.idQuery === null || typeof state.idQuery === 'string');
  return (
    validCounts &&
    validIds &&
    validCursor &&
    typeof state.complete === 'boolean' &&
    state.storeDomain === identity.storeDomain &&
    state.apiVersion === identity.apiVersion &&
    state.queryVersion === identity.queryVersion &&
    String(state.checkpointSheetId || '') === identity.checkpointSheetId
  );
}

function initializeShopifySkuCheckpoint_(sheet, startedAt, identity) {
  sheet.clearContents();
  ensureShopifySkuSheetSize_(sheet, 1, 1);
  sheet.getRange(1, 1).setValue('variantJson');
  const state = {
    version: KEA_SHOPIFY_SKU_CHECKPOINT_VERSION,
    storeDomain: identity.storeDomain,
    apiVersion: identity.apiVersion,
    queryVersion: identity.queryVersion,
    checkpointSheetId: identity.checkpointSheetId,
    startedAt: startedAt,
    updatedAt: startedAt,
    runCount: 1,
    totalVariants: 0,
    after: null,
    idQuery: null,
    partitionVariantCount: 0,
    upperVariantId: '',
    lastVariantId: '',
    complete: false,
  };
  writeShopifySkuCheckpointState_(state);
  return state;
}

function prepareShopifySkuCheckpoint_(startedAt, identity) {
  const sheet = getShopifySkuCheckpointSheet_();
  const checkpointIdentity = Object.assign({}, identity, {
    checkpointSheetId: String(sheet.getSheetId()),
  });
  let state = readShopifySkuCheckpointState_();
  if (
    !shopifySkuCheckpointCompatible_(state, checkpointIdentity) ||
    !state
  ) return {
    sheet: sheet,
    state: initializeShopifySkuCheckpoint_(
      sheet,
      startedAt,
      checkpointIdentity,
    ),
  };
  if (String(sheet.getRange(1, 1).getValue() || '') !== 'variantJson') {
    return {
      sheet: sheet,
      state: initializeShopifySkuCheckpoint_(
        sheet,
        startedAt,
        checkpointIdentity,
      ),
    };
  }
  const actualRows = Math.max(0, sheet.getLastRow() - 1);
  if (actualRows < Number(state.totalVariants || 0)) {
    return {
      sheet: sheet,
      state: initializeShopifySkuCheckpoint_(
        sheet,
        startedAt,
        checkpointIdentity,
      ),
    };
  }
  if (actualRows > Number(state.totalVariants || 0)) {
    sheet
      .getRange(
        Number(state.totalVariants || 0) + 2,
        1,
        actualRows - Number(state.totalVariants || 0),
        1,
      )
      .clearContent();
  }
  if (Number(state.totalVariants || 0) > 0) {
    let lastStored = null;
    try {
      lastStored = JSON.parse(String(
        sheet.getRange(Number(state.totalVariants) + 1, 1).getValue() || '',
      ));
    } catch (error) {
      lastStored = null;
    }
    if (
      !lastStored ||
      shopifyNumericGid_(lastStored.id) !== String(state.lastVariantId || '')
    ) {
      return {
        sheet: sheet,
        state: initializeShopifySkuCheckpoint_(
          sheet,
          startedAt,
          checkpointIdentity,
        ),
      };
    }
  }
  state.runCount = Number(state.runCount || 0) + 1;
  state.updatedAt = startedAt;
  writeShopifySkuCheckpointState_(state);
  return { sheet: sheet, state: state };
}

function appendShopifySkuCheckpointVariants_(sheet, startIndex, variants) {
  if (!variants || !variants.length) return;
  const rows = variants.map(function (variant) {
    return [JSON.stringify(variant)];
  });
  const firstRow = Number(startIndex) + 2;
  ensureShopifySkuSheetSize_(sheet, firstRow + rows.length - 1, 1);
  sheet.getRange(firstRow, 1, rows.length, 1).setValues(rows);
}

function validateShopifySkuCheckpointPage_(sheet, startIndex, variants) {
  if (!variants || !variants.length) return true;
  const firstRow = Number(startIndex) + 2;
  const values = sheet
    .getRange(firstRow, 1, variants.length, 1)
    .getValues();
  values.forEach(function (row, index) {
    let stored = null;
    try {
      stored = JSON.parse(String(row[0] || ''));
    } catch (error) {
      throw new Error('Shopify SKU checkpoint page JSON検証失敗');
    }
    if (!stored || stored.id !== variants[index].id) {
      throw new Error('Shopify SKU checkpoint page ID検証失敗');
    }
  });
  return true;
}

function validateShopifySkuCatalogPageIds_(state, variants) {
  let previous = String(state.lastVariantId || '');
  const upper = String(state.upperVariantId || '');
  if (!upper || !/^\d+$/.test(upper)) {
    throw new Error('Shopify SKU catalogのsnapshot上限が不正です。');
  }
  (variants || []).forEach(function (variant) {
    const current = shopifyNumericGid_(variant && variant.id);
    if (!current) {
      throw new Error('Shopify SKU catalogのvariant IDが不正です。');
    }
    if (previous && shopifySkuNumericIdCompare_(current, previous) <= 0) {
      throw new Error('Shopify SKU catalogのvariant ID順序が不正です。');
    }
    if (shopifySkuNumericIdCompare_(current, upper) > 0) {
      throw new Error('Shopify SKU catalogがsnapshot上限を超えました。');
    }
    previous = current;
  });
  return previous;
}

function checkpointShopifySkuResumeById_(sheet, state) {
  if (!state || state.complete || Number(state.totalVariants || 0) < 1) {
    return state;
  }
  const text = sheet
    .getRange(Number(state.totalVariants) + 1, 1)
    .getValue();
  let variant = null;
  try {
    variant = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error('Shopify SKU checkpoint再開行が不正です。');
  }
  const numericId = shopifyNumericGid_(variant && variant.id);
  if (
    !numericId ||
    numericId !== String(state.lastVariantId || '')
  ) {
    throw new Error('Shopify SKU checkpoint再開IDが不正です。');
  }
  state.idQuery = shopifySkuIdRangeQuery_(
    numericId,
    state.upperVariantId,
  );
  state.after = null;
  state.partitionVariantCount = 0;
  state.updatedAt = isoTimestamp_(new Date());
  writeShopifySkuCheckpointState_(state);
  return state;
}

function loadShopifySkuCheckpointVariants_(sheet, totalVariants) {
  const total = Number(totalVariants || 0);
  const variants = [];
  const ids = Object.create(null);
  const chunkSize = 500;
  for (let offset = 0; offset < total; offset += chunkSize) {
    const count = Math.min(chunkSize, total - offset);
    const values = sheet.getRange(offset + 2, 1, count, 1).getValues();
    values.forEach(function (row) {
      let variant = null;
      try {
        variant = JSON.parse(String(row[0] || ''));
      } catch (error) {
        throw new Error('Shopify SKU checkpoint JSONが不正です。');
      }
      if (!variant || !variant.id || ids[variant.id]) {
        throw new Error('Shopify SKU checkpointのvariant IDが欠落・重複しています。');
      }
      ids[variant.id] = true;
      variants.push(variant);
    });
  }
  return variants;
}

function clearShopifySkuCheckpoint_() {
  PropertiesService.getScriptProperties().deleteProperty(
    KEA_SHOPIFY_SKU_CHECKPOINT_KEY,
  );
  try {
    const spreadsheet = getDashboardSpreadsheet_();
    const sheet = spreadsheet.getSheetByName(KEA_SHOPIFY_SKU_CHECKPOINT_SHEET);
    if (sheet) {
      sheet.clearContents();
      sheet.getRange(1, 1).setValue('variantJson');
    }
  } catch (error) {
    console.error(
      'Shopify SKU checkpoint sheet cleanup: ' +
        String(error && error.message || error),
    );
  }
}

function shopifySkuPublishReserveMs_(rowCount) {
  const chunks = Math.max(1, Math.ceil(Number(rowCount || 1) / 500));
  return 45000 + chunks * 3000;
}

function shopifySkuBackupReserveMs_(rowCount) {
  const chunks = Math.max(1, Math.ceil(Number(rowCount || 1) / 500));
  return 40000 + chunks * 2000;
}

function shopifySkuLiveCommitReserveMs_(rowCount) {
  const chunks = Math.max(1, Math.ceil(Number(rowCount || 1) / 500));
  return 30000 + chunks * 700;
}

function requireShopifySkuDeadline_(deadlineAtMs, reserveMs) {
  if (shopifySkuDeadlineReached_(deadlineAtMs, reserveMs)) {
    throw shopifySkuTimeBudgetError_();
  }
}

function writeShopifySkuSheetInChunks_(
  sheet,
  headers,
  rows,
  deadlineAtMs,
  reserveMs,
) {
  const totalRows = Math.max(1, rows.length + 1);
  ensureShopifySkuSheetSize_(sheet, totalRows, headers.length);
  requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
    const chunk = rows.slice(offset, offset + chunkSize);
    sheet
      .getRange(offset + 2, 1, chunk.length, headers.length)
      .setValues(chunk);
  }
}

function shopifySkuSheetCellMatches_(actual, expected) {
  const actualText = String(
    actual === null || actual === undefined ? '' : actual,
  );
  const expectedText = String(
    expected === null || expected === undefined ? '' : expected,
  );
  if (actualText === expectedText) return true;
  return (
    /^'[=+\-@]/.test(expectedText) &&
    actualText === expectedText.slice(1)
  );
}

function validateShopifySkuSheetRows_(
  sheet,
  headers,
  rows,
  deadlineAtMs,
  reserveMs,
) {
  requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
  const actualHeaders = sheet
    .getRange(1, 1, 1, headers.length)
    .getValues()[0];
  headers.forEach(function (header, column) {
    if (!shopifySkuSheetCellMatches_(actualHeaders[column], header)) {
      throw new Error(
        'ShopifySkuAudit staging header検証失敗: column ' + (column + 1),
      );
    }
  });
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
    const expectedChunk = rows.slice(offset, offset + chunkSize);
    const actualChunk = sheet
      .getRange(offset + 2, 1, expectedChunk.length, headers.length)
      .getValues();
    expectedChunk.forEach(function (expectedRow, rowIndex) {
      expectedRow.forEach(function (expected, column) {
        if (
          !shopifySkuSheetCellMatches_(
            actualChunk[rowIndex][column],
            expected,
          )
        ) {
          throw new Error(
            'ShopifySkuAudit staging data検証失敗: row ' +
              (offset + rowIndex + 2) + ', column ' + (column + 1),
          );
        }
      });
    });
  }
  return true;
}

function copyShopifySkuSheetContents_(
  source,
  target,
  rowCount,
  columnCount,
  deadlineAtMs,
  reserveMs,
) {
  ensureShopifySkuSheetSize_(target, rowCount, columnCount);
  const chunkSize = 500;
  for (let offset = 0; offset < rowCount; offset += chunkSize) {
    requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
    const count = Math.min(chunkSize, rowCount - offset);
    source
      .getRange(offset + 1, 1, count, columnCount)
      .copyTo(
        target.getRange(offset + 1, 1, count, columnCount),
        { contentsOnly: true },
      );
  }
}

function shopifySkuSheetValueKey_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value === null || value === undefined ? '' : value);
}

function shopifySkuValuesFingerprint_(rows) {
  return healthHash_((rows || []).map(function (row) {
    return (row || []).map(function (value) {
      return 'V:' + shopifySkuSheetValueKey_(value);
    });
  }));
}

function shopifySkuFingerprintCell_(formula, value) {
  return formula
    ? 'F:' + formula
    : 'V:' + shopifySkuSheetValueKey_(value);
}

function shopifySkuFingerprintFromChunks_(rowCount, columnCount, chunks) {
  return healthHash_({
    version: 1,
    rowCount: rowCount,
    columnCount: columnCount,
    chunks: chunks,
  });
}

function shopifySkuSheetFingerprint_(sheet, rowCount, columnCount) {
  const chunkFingerprints = [];
  const chunkSize = 500;
  for (let offset = 0; offset < rowCount; offset += chunkSize) {
    const count = Math.min(chunkSize, rowCount - offset);
    const range = sheet.getRange(offset + 1, 1, count, columnCount);
    const formulas = range.getFormulas();
    const values = range.getValues();
    const cells = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        cells.push(
          shopifySkuFingerprintCell_(
            formulas[row][column],
            values[row][column],
          ),
        );
      }
    }
    chunkFingerprints.push(healthHash_(cells));
  }
  return shopifySkuFingerprintFromChunks_(
    rowCount,
    columnCount,
    chunkFingerprints,
  );
}

function validateShopifySkuSheetCopy_(
  source,
  target,
  rowCount,
  columnCount,
  deadlineAtMs,
  reserveMs,
) {
  const sourceChunkFingerprints = [];
  const targetChunkFingerprints = [];
  const chunkSize = 500;
  for (let offset = 0; offset < rowCount; offset += chunkSize) {
    requireShopifySkuDeadline_(deadlineAtMs, reserveMs);
    const count = Math.min(chunkSize, rowCount - offset);
    const sourceRange = source.getRange(offset + 1, 1, count, columnCount);
    const targetRange = target.getRange(offset + 1, 1, count, columnCount);
    const sourceFormulas = sourceRange.getFormulas();
    const targetFormulas = targetRange.getFormulas();
    const sourceValues = sourceRange.getValues();
    const targetValues = targetRange.getValues();
    const sourceCells = [];
    const targetCells = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        sourceCells.push(
          shopifySkuFingerprintCell_(
            sourceFormulas[row][column],
            sourceValues[row][column],
          ),
        );
        targetCells.push(
          shopifySkuFingerprintCell_(
            targetFormulas[row][column],
            targetValues[row][column],
          ),
        );
        if (sourceFormulas[row][column] !== targetFormulas[row][column]) {
          throw new Error('ShopifySkuAudit backup formula検証失敗');
        }
        if (
          !sourceFormulas[row][column] &&
          shopifySkuSheetValueKey_(sourceValues[row][column]) !==
            shopifySkuSheetValueKey_(targetValues[row][column])
        ) {
          throw new Error('ShopifySkuAudit backup value検証失敗');
        }
      }
    }
    sourceChunkFingerprints.push(healthHash_(sourceCells));
    targetChunkFingerprints.push(healthHash_(targetCells));
  }
  return {
    sourceFingerprint: shopifySkuFingerprintFromChunks_(
      rowCount,
      columnCount,
      sourceChunkFingerprints,
    ),
    targetFingerprint: shopifySkuFingerprintFromChunks_(
      rowCount,
      columnCount,
      targetChunkFingerprints,
    ),
  };
}

function shopifySkuSheetById_(spreadsheet, sheetId, fallbackName) {
  if (typeof spreadsheet.getSheetById === 'function') {
    const byId = spreadsheet.getSheetById(Number(sheetId));
    if (byId) return byId;
  }
  const sheets = spreadsheet.getSheets();
  for (let index = 0; index < sheets.length; index += 1) {
    if (sheets[index].getSheetId() === Number(sheetId)) return sheets[index];
  }
  const fallback = spreadsheet.getSheetByName(fallbackName);
  return fallback && fallback.getSheetId() === Number(sheetId)
    ? fallback
    : null;
}

function getFixedShopifySkuHelperSheet_(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  try {
    sheet.hideSheet();
  } catch (error) {
    console.error(
      'ShopifySkuAudit helper sheet hide: ' +
        String(error && error.message || error),
    );
  }
  return sheet;
}

function shopifySkuSpreadsheetId_(spreadsheet) {
  const id = spreadsheet && typeof spreadsheet.getId === 'function'
    ? String(spreadsheet.getId() || '')
    : '';
  if (!id) throw new Error('ShopifySkuAudit spreadsheet IDを取得できません。');
  return id;
}

function flushShopifySkuSheets_() {
  SpreadsheetApp.flush();
}

function readShopifySkuPublishWal_() {
  const text = PropertiesService.getScriptProperties().getProperty(
    KEA_SHOPIFY_SKU_PUBLISH_WAL_KEY,
  );
  if (!text) return null;
  try {
    const wal = JSON.parse(text);
    const validPhase =
      wal &&
      ['BACKUP_READY', 'PUBLISHING', 'COMMITTED'].indexOf(wal.phase) >= 0;
    const validSheetIds = [
      wal && wal.liveSheetId,
      wal && wal.stagingSheetId,
      wal && wal.backupSheetId,
    ].every(function (value) {
      return Number.isFinite(Number(value)) && Number(value) > 0;
    });
    const validDimensions =
      wal &&
      Number.isFinite(Number(wal.managedRowCount)) &&
      Number(wal.managedRowCount) >= 1 &&
      Number.isFinite(Number(wal.columnCount)) &&
      Number(wal.columnCount) >= 1;
    const validIdentity =
      wal &&
      typeof wal.spreadsheetId === 'string' &&
      !!wal.spreadsheetId &&
      typeof wal.schemaFingerprint === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(wal.schemaFingerprint) &&
      typeof wal.backupFingerprint === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(wal.backupFingerprint);
    if (
      wal.version !== 1 ||
      !validPhase ||
      !validSheetIds ||
      !validDimensions ||
      !validIdentity
    ) {
      throw new Error('invalid WAL fields');
    }
    return wal;
  } catch (error) {
    throw new Error('ShopifySkuAudit publish WALが不正です。');
  }
}

function writeShopifySkuPublishWal_(wal) {
  PropertiesService.getScriptProperties().setProperty(
    KEA_SHOPIFY_SKU_PUBLISH_WAL_KEY,
    JSON.stringify(wal),
  );
}

function clearShopifySkuPublishWal_() {
  PropertiesService.getScriptProperties().deleteProperty(
    KEA_SHOPIFY_SKU_PUBLISH_WAL_KEY,
  );
}

function recoverShopifySkuPublishIfNeeded_(spreadsheet) {
  const wal = readShopifySkuPublishWal_();
  if (!wal) return { recovered: false };
  if (shopifySkuSpreadsheetId_(spreadsheet) !== wal.spreadsheetId) {
    throw new Error('ShopifySkuAudit publish WALのspreadsheet IDが不一致です。');
  }
  if (wal.phase === 'COMMITTED' || wal.phase === 'BACKUP_READY') {
    clearShopifySkuPublishWal_();
    return { recovered: false, discarded: wal.phase };
  }
  const live = shopifySkuSheetById_(
    spreadsheet,
    wal.liveSheetId,
    KEA_SHOPIFY_SKU_AUDIT_SHEET,
  );
  const backup = shopifySkuSheetById_(
    spreadsheet,
    wal.backupSheetId,
    KEA_SHOPIFY_SKU_BACKUP_SHEET,
  );
  if (!live || !backup) {
    throw new Error('ShopifySkuAudit publish rollback用sheetが見つかりません。');
  }
  const rowCount = Number(wal.managedRowCount || 1);
  const columnCount = Number(wal.columnCount || 1);
  if (
    shopifySkuSheetFingerprint_(backup, rowCount, columnCount) !==
    wal.backupFingerprint
  ) {
    throw new Error('ShopifySkuAudit publish backup checksumが不一致です。');
  }
  ensureShopifySkuSheetSize_(live, rowCount, columnCount);
  live.getRange(1, 1, rowCount, columnCount).clearContent();
  copyShopifySkuSheetContents_(
    backup,
    live,
    rowCount,
    columnCount,
  );
  flushShopifySkuSheets_();
  validateShopifySkuSheetCopy_(backup, live, rowCount, columnCount);
  const properties = PropertiesService.getScriptProperties();
  if (wal.previousRowCountText) {
    properties.setProperty(
      KEA_SHOPIFY_SKU_LIVE_ROW_COUNT_KEY,
      wal.previousRowCountText,
    );
  } else {
    properties.deleteProperty(KEA_SHOPIFY_SKU_LIVE_ROW_COUNT_KEY);
  }
  clearShopifySkuPublishWal_();
  return { recovered: true, liveSheetId: live.getSheetId() };
}

function recoverShopifySkuPublishBeforeAudit_() {
  if (!readShopifySkuPublishWal_()) return { recovered: false };
  return recoverShopifySkuPublishIfNeeded_(getDashboardSpreadsheet_());
}

function restoreShopifySkuTrailingFormulas_(
  backup,
  live,
  firstRow,
  lastRow,
  columnCount,
) {
  if (firstRow > lastRow) return;
  const chunkSize = 500;
  for (let row = firstRow; row <= lastRow; row += chunkSize) {
    const count = Math.min(chunkSize, lastRow - row + 1);
    const formulas = backup
      .getRange(row, 1, count, columnCount)
      .getFormulas();
    live.getRange(row, 1, count, columnCount).setFormulas(formulas);
  }
}

function writeShopifySkuAudit_(audit, deadlineAtMs) {
  const spreadsheet = getDashboardSpreadsheet_();
  recoverShopifySkuPublishIfNeeded_(spreadsheet);
  const spreadsheetId = shopifySkuSpreadsheetId_(spreadsheet);
  const headers = KEA_HEALTH_SHEETS.ShopifySkuAudit;
  const rows = shopifySkuSheetRows_(audit);
  const staging = getFixedShopifySkuHelperSheet_(
    spreadsheet,
    KEA_SHOPIFY_SKU_STAGING_SHEET,
  );
  const backup = getFixedShopifySkuHelperSheet_(
    spreadsheet,
    KEA_SHOPIFY_SKU_BACKUP_SHEET,
  );
  let live = spreadsheet.getSheetByName(KEA_SHOPIFY_SKU_AUDIT_SHEET);
  if (!live) live = spreadsheet.insertSheet(KEA_SHOPIFY_SKU_AUDIT_SHEET);
  const liveSheetId = live.getSheetId();
  const properties = PropertiesService.getScriptProperties();
  const previousRowCountText = properties.getProperty(
    KEA_SHOPIFY_SKU_LIVE_ROW_COUNT_KEY,
  );
  const previousRowCount = Number(previousRowCountText || 0);
  const newRowCount = rows.length + 1;
  const managedRowCount = Math.max(
    1,
    newRowCount,
    previousRowCount,
    live.getLastRow(),
  );
  const backupReserveMs = shopifySkuBackupReserveMs_(managedRowCount);
  const liveCommitReserveMs = shopifySkuLiveCommitReserveMs_(
    managedRowCount,
  );
  staging.clearContents();
  backup.clearContents();
  ensureShopifySkuSheetSize_(staging, newRowCount, headers.length);
  ensureShopifySkuSheetSize_(backup, managedRowCount, headers.length);
  try {
    writeShopifySkuSheetInChunks_(
      staging,
      headers,
      rows,
      deadlineAtMs,
      backupReserveMs,
    );
    flushShopifySkuSheets_();
    validateShopifySkuSheetRows_(
      staging,
      headers,
      rows,
      deadlineAtMs,
      backupReserveMs,
    );
    requireShopifySkuDeadline_(deadlineAtMs, backupReserveMs);

    ensureShopifySkuSheetSize_(live, managedRowCount, headers.length);
    copyShopifySkuSheetContents_(
      live,
      backup,
      managedRowCount,
      headers.length,
      deadlineAtMs,
      liveCommitReserveMs,
    );
    flushShopifySkuSheets_();
    const backupValidation = validateShopifySkuSheetCopy_(
      live,
      backup,
      managedRowCount,
      headers.length,
      deadlineAtMs,
      liveCommitReserveMs,
    );
    requireShopifySkuDeadline_(deadlineAtMs, liveCommitReserveMs);

    const wal = {
      version: 1,
      phase: 'BACKUP_READY',
      spreadsheetId: spreadsheetId,
      schemaFingerprint: shopifySkuValuesFingerprint_([headers]),
      backupFingerprint: backupValidation.targetFingerprint,
      liveSheetId: liveSheetId,
      stagingSheetId: staging.getSheetId(),
      backupSheetId: backup.getSheetId(),
      previousRowCountText: previousRowCountText || '',
      newRowCount: newRowCount,
      managedRowCount: managedRowCount,
      columnCount: headers.length,
      updatedAt: isoTimestamp_(new Date()),
    };
    writeShopifySkuPublishWal_(wal);
    const persistedWal = readShopifySkuPublishWal_();
    if (
      !persistedWal ||
      persistedWal.phase !== 'BACKUP_READY' ||
      persistedWal.spreadsheetId !== spreadsheetId ||
      persistedWal.liveSheetId !== liveSheetId ||
      persistedWal.backupFingerprint !== wal.backupFingerprint
    ) {
      throw new Error('ShopifySkuAudit publish WAL永続化失敗');
    }
    wal.phase = 'PUBLISHING';
    wal.updatedAt = isoTimestamp_(new Date());
    writeShopifySkuPublishWal_(wal);
    const publishingWal = readShopifySkuPublishWal_();
    if (
      !publishingWal ||
      publishingWal.phase !== 'PUBLISHING' ||
      publishingWal.spreadsheetId !== spreadsheetId ||
      publishingWal.liveSheetId !== liveSheetId ||
      publishingWal.backupFingerprint !== wal.backupFingerprint
    ) {
      throw new Error('ShopifySkuAudit PUBLISHING WAL永続化失敗');
    }

    live
      .getRange(1, 1, managedRowCount, headers.length)
      .clearContent();
    copyShopifySkuSheetContents_(
      staging,
      live,
      newRowCount,
      headers.length,
    );
    restoreShopifySkuTrailingFormulas_(
      backup,
      live,
      newRowCount + 1,
      managedRowCount,
      headers.length,
    );
    flushShopifySkuSheets_();
    validateShopifySkuSheetRows_(live, headers, rows);
    if (live.getSheetId() !== liveSheetId) {
      throw new Error('ShopifySkuAudit live sheetIdが変化しました。');
    }
    properties.setProperty(
      KEA_SHOPIFY_SKU_LIVE_ROW_COUNT_KEY,
      String(newRowCount),
    );
    wal.phase = 'COMMITTED';
    wal.updatedAt = isoTimestamp_(new Date());
    writeShopifySkuPublishWal_(wal);
    clearShopifySkuPublishWal_();
    staging.clearContents();
    backup.clearContents();
    return live;
  } catch (error) {
    let activeWal = null;
    try {
      activeWal = readShopifySkuPublishWal_();
    } catch (walError) {
      activeWal = { phase: 'INVALID' };
    }
    if (isShopifySkuTimeBudgetError_(error) && !activeWal) {
      return {
        published: false,
        inProgress: true,
        phase: 'STAGING_OR_BACKUP',
      };
    }
    let rollbackError = null;
    try {
      recoverShopifySkuPublishIfNeeded_(spreadsheet);
    } catch (restoreError) {
      rollbackError = restoreError;
    }
    throw new Error(
      String(error && error.message || error) +
        (rollbackError
          ? ' / rollback失敗: ' +
            String(rollbackError && rollbackError.message || rollbackError)
          : ' / live sheetは旧値を維持またはrollback済み'),
    );
  }
}

function shopifySkuRecommendations_(summary) {
  const recommendations = [];
  const add = function (key, priority, evidence, recommendation) {
    recommendations.push(
      healthRecommendation_(
        'SHOPIFY_SKU',
        key,
        'SKU監査',
        priority,
        'Shopify商品',
        evidence,
        recommendation,
      ),
    );
  };
  if (summary.productCodeMissingCount) {
    add(
      'product-code-missing',
      '高',
      '商品コード欠落 ' + summary.productCodeMissingCount + 'バリエーション',
      'ShopifySkuAuditを確認し、custom.product_codeへ正式な商品コードを登録します。推測では登録しません。',
    );
  }
  if (summary.productCodeIssueCount) {
    add(
      'product-code-invalid',
      '高',
      '商品コード異常 ' + summary.productCodeIssueCount + 'バリエーション',
      'ShopifySkuAuditの元値と正規化後の商品コードを確認します。',
    );
  }
  if (summary.duplicateProductCodeCount) {
    add(
      'product-code-duplicate',
      '最優先',
      '重複商品コード ' + summary.duplicateProductCodeCount + '件 / 影響 ' +
        summary.productCodeDuplicateVariantCount + 'バリエーション',
      '同じ商品コードを持つ別商品とブランドを確認し、根拠がない場合は例外として残します。',
    );
  }
  if (summary.expectedVendorMismatchCount) {
    add(
      'expected-vendor-mismatch',
      '高',
      'CH0096Sの期待ブランドはChloé / 不一致 ' +
        summary.expectedVendorMismatchCount + 'バリエーション',
      '商品コードCH0096Sの商品vendorをChloéと照合します。商品コードやブランドは自動変更しません。',
    );
  }
  if (summary.optionIssueCount) {
    add(
      'option-invalid',
      '高',
      'サイズ・カラーoption異常 ' + summary.optionIssueCount + 'バリエーション',
      'ShopifySkuAuditを確認し、サイズとカラーの選択値を修正します。',
    );
  }
  if (summary.skuBlankCount) {
    add(
      'sku-blank',
      '高',
      'SKU空欄 ' + summary.skuBlankCount + 'バリエーション',
      'バックアップと承認後に、期待SKUをShopifyへ反映します。この監視は商品を変更しません。',
    );
  }
  if (summary.skuFormatCount) {
    add(
      'sku-format',
      '高',
      'SKU形式違反 ' + summary.skuFormatCount + 'バリエーション',
      '現在SKUと期待SKUを照合し、承認後に修正します。この監視は商品を変更しません。',
    );
  }
  if (summary.duplicateSkuCount) {
    add(
      'sku-duplicate',
      '最優先',
      '重複SKU ' + summary.duplicateSkuCount + '件 / 影響 ' +
        summary.duplicateVariantCount + 'バリエーション',
      'ShopifySkuAuditで同一商品内と別商品間の重複を確認し、商品コードを推測せず修正します。',
    );
  }
  return recommendations;
}

function shopifySkuNotificationIssues_(audit) {
  if (!audit.summary.issueVariantCount) return [];
  const affected = audit.rows
    .filter(function (row) {
      return row.auditStatus !== 'OK';
    })
    .map(function (row) {
      return row.variantId + '|' + row.issueCodes.join(',');
    })
    .sort();
  return [
    {
      key:
        'SHOPIFY_SKU|issues|' + audit.summary.issueVariantCount + '|' +
        healthHash_(affected),
      text:
        'Shopify SKU要確認 ' + audit.summary.issueVariantCount + '件' +
        ' / 空欄 ' + audit.summary.skuBlankCount +
        ' / 形式違反 ' + audit.summary.skuFormatCount +
        ' / 重複 ' + audit.summary.duplicateSkuCount +
        ' / 重複商品コード ' + audit.summary.duplicateProductCodeCount +
        ' / 期待ブランド不一致 ' + audit.summary.expectedVendorMismatchCount +
        ' / 商品コード欠落 ' + audit.summary.productCodeMissingCount +
        ' / option異常 ' + audit.summary.optionIssueCount,
    },
  ];
}

function shopifySkuInProgressHealthResult_(catalog, checkedAt) {
  return {
    source: 'SHOPIFY_SKU',
    available: true,
    inProgress: true,
    connectionStatus: 'in_progress',
    checkedAt: checkedAt,
    sheetName: KEA_SHOPIFY_SKU_AUDIT_SHEET,
    state: null,
    checkpoint: {
      startedAt: catalog.checkpointStartedAt,
      updatedAt: catalog.checkpointUpdatedAt,
      runCount: catalog.checkpointRunCount,
      variantsCollected: catalog.variantsCollected,
      collectionComplete: !!catalog.collectionComplete,
    },
    recommendations: [],
    notificationIssues: [],
  };
}

function runShopifySkuAuditCore_(config, executionDeadlineAtMs) {
  recoverShopifySkuPublishBeforeAudit_();
  const checkedAt = isoTimestamp_(new Date());
  const safeDeadlineAtMs = Number(executionDeadlineAtMs || 0) ||
    Date.now() + KEA_GAS_SAFE_EXECUTION_MS;
  const catalog = collectShopifySkuCatalog_(config, safeDeadlineAtMs);
  if (catalog.inProgress) {
    return shopifySkuInProgressHealthResult_(catalog, checkedAt);
  }
  if (
    shopifySkuDeadlineReached_(
      safeDeadlineAtMs,
      KEA_SHOPIFY_SKU_BUILD_RESERVE_MS,
    )
  ) {
    return shopifySkuInProgressHealthResult_(catalog, checkedAt);
  }
  const audit = buildShopifySkuAudit_(catalog.variants, checkedAt);
  const publishReserveMs = Math.max(
    KEA_SHOPIFY_SKU_PUBLISH_RESERVE_MS,
    shopifySkuPublishReserveMs_(audit.rows.length + 1),
  );
  if (shopifySkuDeadlineReached_(safeDeadlineAtMs, publishReserveMs)) {
    return shopifySkuInProgressHealthResult_(catalog, checkedAt);
  }
  const publishResult = writeShopifySkuAudit_(audit, safeDeadlineAtMs);
  if (publishResult && publishResult.inProgress) {
    return shopifySkuInProgressHealthResult_(catalog, checkedAt);
  }
  clearShopifySkuCheckpoint_();
  return {
    source: 'SHOPIFY_SKU',
    available: true,
    inProgress: false,
    connectionStatus: 'connected',
    checkedAt: checkedAt,
    sheetName: KEA_SHOPIFY_SKU_AUDIT_SHEET,
    state: audit.summary,
    recommendations: shopifySkuRecommendations_(audit.summary),
    notificationIssues: shopifySkuNotificationIssues_(audit),
  };
}

function runShopifySkuAudit() {
  return withScriptLock_('runShopifySkuAudit', function () {
    const startedAt = new Date();
    const executionDeadlineAtMs =
      startedAt.getTime() + KEA_GAS_SAFE_EXECUTION_MS;
    recoverShopifySkuPublishBeforeAudit_();
    ensureHealthSheets_();
    const result = runHealthMonitorSafely_('SHOPIFY_SKU', function () {
      return runShopifySkuAuditCore_(keaConfig_(), executionDeadlineAtMs);
    });
    return finishSingleHealthWatch_(
      'SHOPIFY_SKU',
      result,
      'runShopifySkuAudit',
      startedAt,
    );
  });
}

function runShopifySkuAuditNow() {
  return runShopifySkuAudit();
}

function resetShopifySkuAuditCheckpointNow() {
  return withScriptLock_('resetShopifySkuAuditCheckpoint', function () {
    recoverShopifySkuPublishBeforeAudit_();
    clearShopifySkuCheckpoint_();
    return {
      status: 'reset',
      liveSheetChanged: false,
      checkpointSheet: KEA_SHOPIFY_SKU_CHECKPOINT_SHEET,
    };
  });
}
