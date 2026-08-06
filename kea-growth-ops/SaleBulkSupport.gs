const KEA_SALE_HISTORY_HEADERS = Object.freeze([
  'operationId', 'recordedAt', 'actorEmail', 'mode', 'discountPercent',
  'productId', 'productCode', 'productTitle', 'variantId', 'variantTitle',
  'sku', 'previousPrice', 'previousCompareAtPrice', 'nextPrice',
  'nextCompareAtPrice', 'phase', 'message',
]);

function saleChunks_(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function salePriceFromPercent_(basePrice, discountPercent) {
  const base = saleMoney_(basePrice, '通常価格');
  const percent = Number(discountPercent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
    throw new Error('割引率が不正です。');
  }
  return Math.floor((base * (100 - percent)) / 100 + 1e-9);
}

function saleMoney_(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error((label || '金額') + 'が不正です。');
  }
  return number;
}

function saleNullableMoney_(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return saleMoney_(value, label);
}

function saleMoneyV2_(money) {
  if (!money || money.amount === null || money.amount === undefined) return null;
  return saleMoney_(money.amount, '価格範囲');
}

function saleMoneyInput_(value) {
  const number = saleMoney_(value, '更新金額');
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function saleNullableMoneyInput_(value) {
  return value === null || value === undefined ? null : saleMoneyInput_(value);
}

function saleMoneyEquals_(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

function saleNullableMoneyEquals_(left, right) {
  if (left === null || left === undefined) {
    return right === null || right === undefined;
  }
  if (right === null || right === undefined) return false;
  return saleMoneyEquals_(left, right);
}

function saleVariantLabel_(product, variant) {
  return String(product.title || product.id || '商品') + ' / ' +
    String(variant.title || variant.sku || variant.id || 'バリエーション');
}

function saleActorEmail_() {
  const active = String(Session.getActiveUser().getEmail() || '').trim();
  return active || String(Session.getEffectiveUser().getEmail() || '').trim();
}

function ensureSaleHistorySheet_() {
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName('SaleHistory');
  if (!sheet) sheet = spreadsheet.insertSheet('SaleHistory');
  ensureHeader_(sheet, KEA_SALE_HISTORY_HEADERS);
  sheet.getRange(1, 1, 1, KEA_SALE_HISTORY_HEADERS.length)
    .setBackground('#111111')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getDataRange().setWrap(true);
  return sheet;
}

function appendSaleHistoryRows_(rows) {
  if (!rows || !rows.length) return;
  const sheet = ensureSaleHistorySheet_();
  appendRows_(sheet, rows);
  pruneSheet_(sheet, 10000);
}

function saleHistoryRows_(operationId, recordedAt, actor, input, products, phase, message) {
  const rows = [];
  (products || []).forEach(function (product) {
    (product.variants || []).forEach(function (variant) {
      rows.push([
        operationId,
        recordedAt,
        actor,
        input.mode,
        input.discountPercent === null ? '' : input.discountPercent,
        product.id,
        product.productCode,
        product.title,
        variant.id,
        variant.title,
        variant.sku,
        variant.previousPrice,
        variant.previousCompareAtPrice === null ? '' : variant.previousCompareAtPrice,
        variant.nextPrice,
        variant.nextCompareAtPrice === null ? '' : variant.nextCompareAtPrice,
        phase,
        message,
      ]);
    });
  });
  return rows;
}
