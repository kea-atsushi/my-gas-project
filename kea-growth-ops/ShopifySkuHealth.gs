const KEA_SHOPIFY_SKU_AUDIT_SHEET = 'ShopifySkuAudit';

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
    if (
      row.productId &&
      row.productCode &&
      row.issueCodes.indexOf('PRODUCT_CODE_INTERNAL') < 0 &&
      row.issueCodes.indexOf('PRODUCT_CODE_INVALID') < 0
    ) {
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

function writeShopifySkuSheetInChunks_(sheet, headers, rows) {
  const totalRows = Math.max(1, rows.length + 1);
  ensureShopifySkuSheetSize_(sheet, totalRows, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    sheet
      .getRange(offset + 2, 1, chunk.length, headers.length)
      .setValues(chunk);
  }
}

function writeShopifySkuAudit_(audit) {
  const spreadsheet = getDashboardSpreadsheet_();
  const headers = KEA_HEALTH_SHEETS.ShopifySkuAudit;
  const rows = shopifySkuSheetRows_(audit);
  const stamp = String(new Date().getTime());
  const stagingName = '_ShopifySkuAudit_stage_' + stamp;
  const previousName = '_ShopifySkuAudit_previous_' + stamp;
  const staging = spreadsheet.insertSheet(stagingName);
  let previous = null;
  try {
    writeShopifySkuSheetInChunks_(staging, headers, rows);
    staging
      .getRange(1, 1, 1, headers.length)
      .setBackground('#111111')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    staging.setFrozenRows(1);
    staging.getDataRange().setWrap(true);

    previous = spreadsheet.getSheetByName(KEA_SHOPIFY_SKU_AUDIT_SHEET);
    if (previous) previous.setName(previousName);
    staging.setName(KEA_SHOPIFY_SKU_AUDIT_SHEET);
    if (previous) spreadsheet.deleteSheet(previous);
    return staging;
  } catch (error) {
    const current = spreadsheet.getSheetByName(KEA_SHOPIFY_SKU_AUDIT_SHEET);
    if (previous && !current) previous.setName(KEA_SHOPIFY_SKU_AUDIT_SHEET);
    const failedStaging = spreadsheet.getSheetByName(stagingName);
    if (failedStaging) spreadsheet.deleteSheet(failedStaging);
    throw error;
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
        ' / 商品コード欠落 ' + audit.summary.productCodeMissingCount +
        ' / option異常 ' + audit.summary.optionIssueCount,
    },
  ];
}

function runShopifySkuAuditCore_(config) {
  const checkedAt = isoTimestamp_(new Date());
  const catalog = collectShopifySkuCatalog_(config);
  const audit = buildShopifySkuAudit_(catalog.variants, checkedAt);
  writeShopifySkuAudit_(audit);
  return {
    source: 'SHOPIFY_SKU',
    available: true,
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
    ensureHealthSheets_();
    const result = runHealthMonitorSafely_('SHOPIFY_SKU', function () {
      return runShopifySkuAuditCore_(keaConfig_());
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
