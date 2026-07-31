const KEA_SHEET_ROW_LIMITS = {
  Products: 5000,
  Ads: 5000,
  SearchConsole: 10000,
  Merchant: 3000,
};

function initializeSheets_(spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const names = Object.keys(KEA_REQUIRED_SHEETS);
  names.forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      const sheets = spreadsheet.getSheets();
      if (
        name === 'Daily' &&
        sheets.length === 1 &&
        sheets[0].getLastRow() === 0
      ) {
        sheet = sheets[0];
        sheet.setName(name);
      } else {
        sheet = spreadsheet.insertSheet(name);
      }
    }
    ensureHeader_(sheet, KEA_REQUIRED_SHEETS[name]);
    formatSheet_(sheet, name);
  });
}

function ensureHeader_(sheet, headers) {
  const current =
    sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      : [];
  const matches =
    current.length === headers.length &&
    headers.every(function (header, index) {
      return current[index] === header;
    });
  if (!matches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
}

function formatSheet_(sheet, name) {
  const headerRange = sheet.getRange(
    1,
    1,
    1,
    KEA_REQUIRED_SHEETS[name].length,
  );
  headerRange
    .setBackground('#111111')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setRowHeight(1, 28);
  if (name === 'Daily') {
    sheet
      .getRange('B:F')
      .setNumberFormat('¥#,##0;[Red]-¥#,##0');
    sheet.getRange('G:G').setNumberFormat('0.00');
    sheet.getRange('H:H').setNumberFormat('¥#,##0');
    sheet.getRange('J:J').setNumberFormat('0.0%');
    sheet.getRange('K:K').setNumberFormat('¥#,##0');
    sheet.getRange('O:O').setNumberFormat('0.0%');
    sheet.getRange('U:U').setWrap(true);
  }
  if (name === 'Recommendations') {
    sheet.getRange('E:G').setWrap(true);
  }
}

function replaceSheetRows_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows && rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      rows.length,
      rows[0].length,
    )
    .setValues(rows);
}

function upsertDailySnapshot_(snapshot, report, status) {
  const sheet = getDashboardSpreadsheet_().getSheetByName('Daily');
  const row = [
    snapshot.periodEnd,
    snapshot.shopifySales,
    snapshot.shopifyOrders,
    snapshot.estimatedCogs === null ? '' : snapshot.estimatedCogs,
    snapshot.adCost,
    snapshot.contributionProfit === null
      ? ''
      : snapshot.contributionProfit,
    snapshot.roas,
    snapshot.cpa === null ? '' : snapshot.cpa,
    snapshot.conversions,
    snapshot.ctr,
    snapshot.cpc,
    snapshot.ga4Sessions,
    snapshot.ga4Revenue,
    snapshot.gscClicks,
    snapshot.gscImpressions,
    snapshot.gscCtr,
    snapshot.gscPosition,
    snapshot.merchantApproved,
    snapshot.merchantDisapproved,
    status,
    report,
    isoTimestamp_(new Date()),
  ];
  const values =
    sheet.getLastRow() >= 2
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      : [];
  const index = values.findIndex(function (item) {
    return String(item[0]) === snapshot.periodEnd;
  });
  if (index >= 0) {
    sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
  } else {
    appendRows_(sheet, [row]);
  }
}

function replacePeriodRows_(sheetName, periodEnd, rows) {
  const spreadsheet = getDashboardSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);
  const headers = KEA_REQUIRED_SHEETS[sheetName];
  const existing =
    sheet.getLastRow() >= 2
      ? sheet
          .getRange(
            2,
            1,
            sheet.getLastRow() - 1,
            headers.length,
          )
          .getValues()
      : [];
  const kept = existing.filter(function (row) {
    return String(row[0]) !== String(periodEnd);
  });
  replaceSheetRows_(sheet, headers, kept.concat(rows || []));
  formatSheet_(sheet, sheetName);
  if (KEA_SHEET_ROW_LIMITS[sheetName]) {
    pruneSheet_(sheet, KEA_SHEET_ROW_LIMITS[sheetName]);
  }
}

function writeSourceRows_(periodEnd, data) {
  const productRows = data.shopify.available
    ? data.shopify.products.map(function (product) {
        return [
          periodEnd,
          product.handle,
          product.vendor,
          product.title,
          product.units,
          product.revenue,
          product.estimatedCogs === null
            ? ''
            : product.estimatedCogs,
          product.units > 0 ? '販売あり' : '販売なし',
        ];
      })
    : [];
  replacePeriodRows_('Products', periodEnd, productRows);

  const adRows = data.ads.available
    ? data.ads.campaigns.map(function (campaign) {
        return [
          periodEnd,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.channel,
          campaign.impressions,
          campaign.clicks,
          campaign.cost,
          campaign.conversions,
          campaign.conversionValue,
          campaign.ctr,
          campaign.cpc,
          campaign.cpa,
          campaign.roas,
        ];
      })
    : [];
  replacePeriodRows_('Ads', periodEnd, adRows);

  const searchRows = data.gsc.available
    ? data.gsc.rows.slice(0, 2000).map(function (row) {
        return [
          periodEnd,
          row.query,
          row.page,
          row.clicks,
          row.impressions,
          row.ctr,
          row.position,
        ];
      })
    : [];
  replacePeriodRows_('SearchConsole', periodEnd, searchRows);

  const checkedAt = isoTimestamp_(new Date());
  const merchantRows = data.merchant.available
    ? data.merchant.products.map(function (product) {
        return [
          checkedAt,
          product.offerId,
          product.title,
          product.brand,
          product.availability,
          product.status,
          product.issues.join(' / '),
        ];
      })
    : [];
  replacePeriodRows_('Merchant', checkedAt, merchantRows);
}

function appendRecommendations_(recommendations) {
  if (!recommendations || !recommendations.length) return;
  const sheet =
    getDashboardSpreadsheet_().getSheetByName('Recommendations');
  appendRows_(
    sheet,
    recommendations.map(function (item) {
      return [
        item.createdAt,
        item.cadence,
        item.category,
        item.priority,
        item.target,
        item.evidence,
        item.recommendation,
        item.approvalStatus,
      ];
    }),
  );
  pruneSheet_(sheet, 5000);
}

function appendProductAutomation_(rows) {
  if (!rows || !rows.length) return;
  const sheet =
    getDashboardSpreadsheet_().getSheetByName('ProductAutomation');
  appendRows_(
    sheet,
    rows.map(function (item) {
      return [
        item.detectedAt,
        item.productId,
        item.handle,
        item.productUrl,
        item.seoStatus,
        item.merchantRefresh,
        item.sitemapSubmit,
        item.urlInspection,
        item.adsAction,
        item.manualAction,
      ];
    }),
  );
  pruneSheet_(sheet, 3000);
}

function pruneSheet_(sheet, maximumDataRows) {
  const dataRows = Math.max(0, sheet.getLastRow() - 1);
  if (dataRows <= maximumDataRows) return;
  sheet.deleteRows(2, dataRows - maximumDataRows);
}

function logRun_(startedAt, handler, status, message) {
  const config = keaConfig_();
  if (!String(config.DASHBOARD_SPREADSHEET_ID || '').trim()) {
    console.log(handler + ' ' + status + ': ' + message);
    return;
  }
  const sheet = getDashboardSpreadsheet_().getSheetByName('RunLog');
  appendRows_(sheet, [
    [
      isoTimestamp_(startedAt),
      handler,
      status,
      String(message || '').slice(0, 5000),
      isoTimestamp_(new Date()),
    ],
  ]);
  pruneSheet_(sheet, 2000);
}

function sendGrowthReport_(cadence, periodEnd, report, snapshot) {
  const emails = String(keaConfig_().REPORT_EMAILS || '')
    .split(',')
    .map(function (email) {
      return email.trim();
    })
    .filter(Boolean);
  if (!emails.length) return { status: 'skipped', reason: 'REPORT_EMAILS未設定' };
  const label = cadence === 'weekly' ? '週次改善提案' : '毎朝レポート';
  const subject =
    '[Kea.] ' + label + ' ' + dateKey_(periodEnd);
  MailApp.sendEmail({
    to: emails.join(','),
    subject: subject,
    body: report,
    htmlBody: reportToHtml_(report, snapshot),
    name: 'Kea. Growth Ops',
  });
  return { status: 'sent', recipients: emails };
}

function reportToHtml_(report, snapshot) {
  const body = escapeHtml_(report).replace(/\n/g, '<br>');
  const profit =
    snapshot.contributionProfit === null
      ? '原価未取得'
      : yen_(snapshot.contributionProfit);
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#171717;line-height:1.65">',
    '<h1 style="font-size:20px">Kea. Growth Ops</h1>',
    '<table style="border-collapse:collapse;width:100%;max-width:680px">',
    metricCell_('売上', yen_(snapshot.shopifySales)),
    metricCell_('広告費', yen_(snapshot.adCost)),
    metricCell_('ROAS', decimal_(snapshot.roas)),
    metricCell_('CPA', yen_(snapshot.cpa)),
    metricCell_('貢献利益', profit),
    '</table>',
    '<div style="margin-top:24px;white-space:normal">' + body + '</div>',
    '</div>',
  ].join('');
}

function metricCell_(label, value) {
  return (
    '<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">' +
    escapeHtml_(label) +
    '</th><td style="text-align:right;padding:8px;border-bottom:1px solid #ddd">' +
    escapeHtml_(value) +
    '</td></tr>'
  );
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readDashboardData_() {
  const spreadsheet = getDashboardSpreadsheet_();
  const dailySheet = spreadsheet.getSheetByName('Daily');
  const dailyValues = dailySheet.getDataRange().getValues();
  const dailyHeaders = dailyValues.shift() || [];
  const latestDaily = dailyValues.length
    ? rowObject_(dailyHeaders, dailyValues[dailyValues.length - 1])
    : {};
  const productSheet = spreadsheet.getSheetByName('Products');
  const productValues = productSheet.getDataRange().getValues();
  const productHeaders = productValues.shift() || [];
  const latestPeriod = latestDaily.date || '';
  const products = productValues
    .map(function (row) {
      return rowObject_(productHeaders, row);
    })
    .filter(function (row) {
      return String(row.periodEnd) === String(latestPeriod);
    })
    .sort(function (left, right) {
      return Number(right.revenue || 0) - Number(left.revenue || 0);
    })
    .slice(0, 12);
  const recommendationSheet =
    spreadsheet.getSheetByName('Recommendations');
  const recommendationValues =
    recommendationSheet.getDataRange().getValues();
  const recommendationHeaders = recommendationValues.shift() || [];
  const recommendations = recommendationValues
    .slice(-30)
    .reverse()
    .map(function (row) {
      return rowObject_(recommendationHeaders, row);
    });
  return {
    generatedAt: isoTimestamp_(new Date()),
    spreadsheetUrl: spreadsheet.getUrl(),
    metrics: latestDaily,
    products: products,
    recommendations: recommendations,
    health: {
      merchant: readLatestHealthRow_('MerchantHealth'),
      seo: readLatestHealthRow_('SEOHealth'),
      meo: readLatestHealthRow_('MEOHealth'),
    },
  };
}

function rowObject_(headers, row) {
  const result = {};
  headers.forEach(function (header, index) {
    result[header] = row[index];
  });
  return result;
}
