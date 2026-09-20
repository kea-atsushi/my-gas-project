const KEA_BRAND_REDIRECT_CHECK_SHEET_ = 'BrandSEOOldRedirects';
const KEA_BRAND_REDIRECT_CHECK_HEADERS_ = [
  'checkedAt', 'brand', 'oldUrl', 'expectedCollectionUrl', 'httpStatus',
  'finalHttpStatus', 'redirectLocation', 'oneToOne', 'result',
];

/** Uses the existing Kea Growth Ops HTTP inspector; read-only. */
function checkKnownOldBrandRedirectsNow() {
  const checkedAt = isoTimestamp_(new Date());
  const targets = [
    ['Oblada', 'https://www.kea.co.jp/store/products/list.php?category_id=526', 'https://store.kea.co.jp/collections/oblada'],
    ['SINME', 'https://www.kea.co.jp/store/products/list.php?category_id=273', 'https://store.kea.co.jp/collections/sinme'],
    ['SEA', 'https://www.kea.co.jp/store/products/list.php?category_id=21', 'https://store.kea.co.jp/collections/sea'],
    ['Velnica', 'https://www.kea.co.jp/store/products/list.php?category_id=23', 'https://store.kea.co.jp/collections/velnica'],
  ];
  const rows = targets.map(function(target) {
    const http = inspectHttpUrl_(target[1]);
    const oneToOne = (http.status === 301 || http.status === 308) && http.location === target[2];
    return [
      checkedAt, target[0], target[1], target[2], http.status || '',
      http.finalStatus || '', http.location || '', oneToOne,
      oneToOne ? 'pass' : 'needs_redirect_review',
    ];
  });
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(KEA_BRAND_REDIRECT_CHECK_SHEET_);
  if (!sheet) sheet = spreadsheet.insertSheet(KEA_BRAND_REDIRECT_CHECK_SHEET_);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, KEA_BRAND_REDIRECT_CHECK_HEADERS_.length)
    .setValues([KEA_BRAND_REDIRECT_CHECK_HEADERS_]);
  sheet.getRange(2, 1, rows.length, KEA_BRAND_REDIRECT_CHECK_HEADERS_.length).setValues(rows);
  sheet.setFrozenRows(1);
  return { status: 'passed', checkedAt: checkedAt, passed: rows.filter(function(row) { return row[7]; }).length, total: rows.length };
}
