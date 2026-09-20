const KEA_BRAND_OLD_URL_AUDIT_SHEET_ = 'BrandSEOOldRedirects';
const KEA_BRAND_OLD_URL_AUDIT_HEADERS_ = [
  'checkedAt', 'brand', 'oldUrl', 'expectedCollectionUrl', 'httpStatus',
  'finalHttpStatus', 'redirectLocation', 'oneToOne', 'result',
];

function auditKnownOldBrandUrlsNow() {
  const checkedAt = isoTimestamp_(new Date());
  const targets = [
    ['Oblada', 'https://www.kea.co.jp/store/products/list.php?category_id=526', 'https://store.kea.co.jp/collections/oblada'],
    ['SINME', 'https://www.kea.co.jp/store/products/list.php?category_id=273', 'https://store.kea.co.jp/collections/sinme'],
    ['SEA', 'https://www.kea.co.jp/store/products/list.php?category_id=21', 'https://store.kea.co.jp/collections/sea'],
    ['Velnica', 'https://www.kea.co.jp/store/products/list.php?category_id=23', 'https://store.kea.co.jp/collections/velnica'],
  ];
  const rows = targets.map(function(target) {
    const response = inspectHttpUrl_(target[1]);
    const location = String(response.redirectLocation || '').replace(/\/$/, '');
    const expected = target[2].replace(/\/$/, '');
    const oneToOne = /^30[12378]$/.test(String(response.httpStatus || '')) && location === expected;
    return [
      checkedAt, target[0], target[1], target[2], response.httpStatus || '',
      response.finalHttpStatus || '', response.redirectLocation || '', oneToOne,
      oneToOne ? 'pass' : 'needs_redirect_review',
    ];
  });
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(KEA_BRAND_OLD_URL_AUDIT_SHEET_);
  if (!sheet) sheet = spreadsheet.insertSheet(KEA_BRAND_OLD_URL_AUDIT_SHEET_);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, KEA_BRAND_OLD_URL_AUDIT_HEADERS_.length)
    .setValues([KEA_BRAND_OLD_URL_AUDIT_HEADERS_]);
  sheet.getRange(2, 1, rows.length, KEA_BRAND_OLD_URL_AUDIT_HEADERS_.length)
    .setValues(rows);
  sheet.setFrozenRows(1);
  return { status: 'passed', checkedAt: checkedAt, passed: rows.filter(function(row) { return row[7]; }).length, total: rows.length };
}
