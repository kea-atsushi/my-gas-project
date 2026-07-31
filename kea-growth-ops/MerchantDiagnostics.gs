const KEA_MERCHANT_ISSUE_SHEET = 'MerchantIssues';
const KEA_MERCHANT_ISSUE_HEADERS = [
  'checkedAt',
  'productId',
  'offerId',
  'title',
  'brand',
  'availability',
  'status',
  'issueCode',
  'canonicalAttribute',
  'severity',
  'resolution',
  'reportingContexts',
  'countries',
  'rawIssueJson',
];

function merchantUniqueStrings_(values) {
  const seen = {};
  return (values || [])
    .map(function (value) {
      return String(value || '').trim();
    })
    .filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function merchantIssueDetails_(issue) {
  const source =
    issue && typeof issue === 'object' ? issue : {};
  const type =
    source.type && typeof source.type === 'object'
      ? source.type
      : {};
  const severity =
    source.severity && typeof source.severity === 'object'
      ? source.severity
      : {};
  const contexts = Array.isArray(severity.severityPerReportingContext)
    ? severity.severityPerReportingContext
    : [];
  const reportingContexts = [];
  const countries = [];

  contexts.forEach(function (context) {
    const reportingContext = String(
      context && context.reportingContext || '',
    ).trim();
    if (reportingContext) reportingContexts.push(reportingContext);

    (context && Array.isArray(context.disapprovedCountries)
      ? context.disapprovedCountries
      : []
    ).forEach(function (country) {
      countries.push('disapproved:' + country);
    });

    (context && Array.isArray(context.demotedCountries)
      ? context.demotedCountries
      : []
    ).forEach(function (country) {
      countries.push('demoted:' + country);
    });
  });

  return {
    code: String(
      type.code ||
        source.code ||
        source.title ||
        source.description ||
        'UNKNOWN_ISSUE',
    ).trim(),
    canonicalAttribute: String(type.canonicalAttribute || '').trim(),
    severity: String(severity.aggregatedSeverity || '').trim(),
    resolution: String(source.resolution || '').trim(),
    reportingContexts: merchantUniqueStrings_(reportingContexts).join(', '),
    countries: merchantUniqueStrings_(countries).join(', '),
    rawJson: JSON.stringify(source),
  };
}

function assertMerchantIssueParser_() {
  const parsed = merchantIssueDetails_({
    type: {
      code: 'apparel_missing_brand',
      canonicalAttribute: 'n:brand',
    },
    severity: {
      aggregatedSeverity: 'DISAPPROVED',
      severityPerReportingContext: [
        {
          reportingContext: 'FREE_LISTINGS',
          disapprovedCountries: ['JP'],
        },
      ],
    },
    resolution: 'MERCHANT_ACTION',
  });

  const checks = [
    [parsed.code, 'apparel_missing_brand', 'issueCode'],
    [parsed.canonicalAttribute, 'n:brand', 'canonicalAttribute'],
    [parsed.severity, 'DISAPPROVED', 'severity'],
    [parsed.resolution, 'MERCHANT_ACTION', 'resolution'],
    [parsed.reportingContexts, 'FREE_LISTINGS', 'reportingContexts'],
    [parsed.countries, 'disapproved:JP', 'countries'],
  ];
  checks.forEach(function (check) {
    if (check[0] !== check[1]) {
      throw new Error(
        'Merchant issue parser failed: ' +
          check[2] +
          ' expected ' +
          check[1] +
          ', got ' +
          check[0],
      );
    }
  });
  return parsed;
}

function collectMerchantIssueDiagnostics_(config) {
  const accountId = String(config.MERCHANT_ACCOUNT_ID || '')
    .replace(/\D/g, '');
  if (!accountId) {
    throw new Error('MERCHANT_ACCOUNT_IDが未設定です。');
  }

  const checkedAt = isoTimestamp_(new Date());
  const url =
    'https://merchantapi.googleapis.com/reports/v1/accounts/' +
    accountId +
    '/reports:search';
  let pageToken = '';
  let productCount = 0;
  let productsWithIssues = 0;
  const rows = [];

  do {
    const body = {
      query:
        'SELECT id, offer_id, title, brand, availability, ' +
        'aggregated_reporting_context_status, item_issues FROM product_view',
      pageSize: 1000,
    };
    if (pageToken) body.pageToken = pageToken;

    const response = googleJson_(
      url,
      { method: 'post', payload: body },
      'Merchant issue diagnostics',
    );

    (response.results || []).forEach(function (row) {
      const view = row.productView || {};
      const itemIssues = Array.isArray(view.itemIssues)
        ? view.itemIssues
        : [];
      productCount += 1;
      if (itemIssues.length) productsWithIssues += 1;

      const issuesForRows = itemIssues.length
        ? itemIssues
        : [
            {
              type: { code: 'NO_ITEM_ISSUES_RETURNED' },
              severity: {},
              resolution: '',
            },
          ];

      issuesForRows.forEach(function (issue) {
        const details = merchantIssueDetails_(issue);
        rows.push([
          checkedAt,
          view.id || '',
          view.offerId || '',
          view.title || '',
          view.brand || '',
          view.availability || '',
          view.aggregatedReportingContextStatus || '',
          details.code,
          details.canonicalAttribute,
          details.severity,
          details.resolution,
          details.reportingContexts,
          details.countries,
          details.rawJson,
        ]);
      });
    });

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return {
    accountId: accountId,
    checkedAt: checkedAt,
    productCount: productCount,
    productsWithIssues: productsWithIssues,
    issueRows: rows.length,
    rows: rows,
  };
}

function writeMerchantIssueDiagnostics_(result) {
  const spreadsheet = getDashboardSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(KEA_MERCHANT_ISSUE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(KEA_MERCHANT_ISSUE_SHEET);
  }

  replaceSheetRows_(
    sheet,
    KEA_MERCHANT_ISSUE_HEADERS,
    result.rows,
  );
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, 1, KEA_MERCHANT_ISSUE_HEADERS.length)
    .setBackground('#111111')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setRowHeight(1, 28);
  sheet.getRange('D:N').setWrap(true);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 320);
  sheet.setColumnWidth(8, 250);
  sheet.setColumnWidth(9, 180);
  sheet.setColumnWidth(12, 180);
  sheet.setColumnWidth(13, 180);
  sheet.setColumnWidth(14, 420);

  return {
    sheetName: KEA_MERCHANT_ISSUE_SHEET,
    sheetUrl: spreadsheet.getUrl() + '#gid=' + sheet.getSheetId(),
  };
}

function refreshMerchantIssueDetailsNow() {
  return withScriptLock_('refreshMerchantIssueDetailsNow', function () {
    const startedAt = new Date();
    try {
      assertMerchantIssueParser_();
      const result = collectMerchantIssueDiagnostics_(keaConfig_());
      const sheet = writeMerchantIssueDiagnostics_(result);
      const output = {
        status: 'passed',
        accountId: result.accountId,
        checkedAt: result.checkedAt,
        products: result.productCount,
        productsWithIssues: result.productsWithIssues,
        issueRows: result.issueRows,
        sheetName: sheet.sheetName,
        sheetUrl: sheet.sheetUrl,
      };
      console.log(JSON.stringify(output, null, 2));
      logRun_(
        startedAt,
        'refreshMerchantIssueDetailsNow',
        'success',
        JSON.stringify(output),
      );
      return output;
    } catch (error) {
      logRun_(
        startedAt,
        'refreshMerchantIssueDetailsNow',
        'failed',
        String(error && error.message || error),
      );
      throw error;
    }
  });
}

function testMerchantIssueParser() {
  return withScriptLock_('testMerchantIssueParser', function () {
    const parsed = assertMerchantIssueParser_();
    const output = {
      status: 'passed',
      issueCode: parsed.code,
      severity: parsed.severity,
      resolution: parsed.resolution,
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  });
}
