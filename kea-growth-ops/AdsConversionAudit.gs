const KEA_ADS_CONVERSION_AUDIT_SHEET_ = 'AdsConversionAudit';

const KEA_ADS_CONVERSION_AUDIT_HEADERS_ = [
  'checkedAt', 'recordType', 'conversionActionId', 'conversionActionName',
  'category', 'type', 'status', 'primaryForGoal', 'countingType',
  'defaultValue', 'defaultCurrency', 'date', 'conversions', 'allConversions',
  'conversionValue', 'allConversionValue', 'result',
];

function adsConversionAuditReplaceRows_(rows) {
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(KEA_ADS_CONVERSION_AUDIT_SHEET_);
  if (!sheet) sheet = spreadsheet.insertSheet(KEA_ADS_CONVERSION_AUDIT_SHEET_);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, KEA_ADS_CONVERSION_AUDIT_HEADERS_.length)
    .setValues([KEA_ADS_CONVERSION_AUDIT_HEADERS_]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, KEA_ADS_CONVERSION_AUDIT_HEADERS_.length)
      .setValues(rows);
  }
  sheet.setFrozenRows(1);
}

/** Read-only audit through the already-authorized Kea Growth Ops Ads client. */
function auditGoogleAdsPurchaseTrackingNow() {
  const config = keaConfig_();
  const checkedAt = isoTimestamp_(new Date());
  const configuration = googleAdsSearch_(
    config,
    'SELECT conversion_action.id, conversion_action.name, conversion_action.category, ' +
      'conversion_action.type, conversion_action.status, conversion_action.primary_for_goal, ' +
      'conversion_action.counting_type, conversion_action.value_settings.default_value, ' +
      'conversion_action.value_settings.default_currency_code FROM conversion_action',
  );
  if (!configuration.available) {
    throw new Error(configuration.reason || 'Google Ads read-only query is unavailable');
  }
  const rows = [];
  (configuration.rows || []).forEach(function(row) {
    const action = row.conversionAction || {};
    const values = action.valueSettings || {};
    rows.push([
      checkedAt, 'configuration', action.id || '', action.name || '', action.category || '',
      action.type || '', action.status || '', action.primaryForGoal, action.countingType || '',
      values.defaultValue || '', values.defaultCurrencyCode || '', '', '', '', '', '',
      action.category === 'PURCHASE' ? 'purchase_action' : 'other_action',
    ]);
  });

  let performanceError = '';
  try {
    const performance = googleAdsSearch_(
      config,
      'SELECT segments.conversion_action, segments.date, metrics.conversions, ' +
        'metrics.all_conversions, metrics.conversions_value, metrics.all_conversions_value ' +
        'FROM customer WHERE segments.date DURING LAST_30_DAYS ' +
        'AND segments.conversion_action IS NOT NULL',
    );
    (performance.rows || []).forEach(function(row) {
      const segments = row.segments || {};
      const metrics = row.metrics || {};
      rows.push([
        checkedAt, 'performance', segments.conversionAction || '', '', '', '', '', '', '', '', '',
        segments.date || '', metrics.conversions || 0, metrics.allConversions || 0,
        metrics.conversionsValue || 0, metrics.allConversionsValue || 0, 'last_30d',
      ]);
    });
  } catch (error) {
    performanceError = String(error && error.message || error);
    rows.push([checkedAt, 'performance_error', '', '', '', '', '', '', '', '', '', '', '', '', '', '', performanceError]);
  }
  adsConversionAuditReplaceRows_(rows);
  const purchases = rows.filter(function(row) {
    return row[1] === 'configuration' && row[4] === 'PURCHASE';
  });
  return {
    status: 'passed', checkedAt: checkedAt, purchaseActionCount: purchases.length,
    primaryPurchaseActionCount: purchases.filter(function(row) { return row[7] === true; }).length,
    performanceError: performanceError,
  };
}
