const KEA_MERCHANT_ISSUE_SHEET = 'MerchantIssues';
const KEA_MERCHANT_ISSUE_HEADERS = [
  'checkedAt',
  'issueLevel',
  'productId',
  'offerId',
  'title',
  'brand',
  'availability',
  'price',
  'status',
  'contextStatuses',
  'issueCode',
  'canonicalAttribute',
  'severity',
  'resolution',
  'reportingContexts',
  'countries',
  'documentationUrl',
  'affectedProducts',
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
  const products = [];

  do {
    const body = {
      query:
        'SELECT id, offer_id, title, brand, availability, price, channel, ' +
        'feed_label, creation_time, aggregated_reporting_context_status, ' +
        'status_per_reporting_context, item_issues FROM product_view',
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
      products.push({
        id: view.id || '',
        offerId: view.offerId || '',
        title: view.title || '',
        brand: view.brand || '',
        availability: view.availability || '',
        price: view.price || null,
        channel: view.channel || '',
        feedLabel: view.feedLabel || '',
        creationTime: view.creationTime || '',
        status: view.aggregatedReportingContextStatus || '',
        statusPerReportingContext: Array.isArray(view.statusPerReportingContext)
          ? view.statusPerReportingContext
          : [],
        itemIssues: itemIssues.map(function (issue) {
          return Object.assign({}, merchantIssueDetails_(issue), {
            raw: issue,
          });
        }),
      });
    });

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  const accountIssueResult = collectMerchantAccountIssues_(accountId);
  const documentation = collectMerchantProductDocumentation_(
    accountId,
    products,
  );
  const rows = buildMerchantIssueRows_(
    checkedAt,
    products,
    accountIssueResult.issues,
    documentation.urls,
  );
  return {
    accountId: accountId,
    checkedAt: checkedAt,
    productCount: productCount,
    productsWithIssues: productsWithIssues,
    issueRows: rows.length,
    products: products,
    accountIssues: accountIssueResult.issues,
    accountIssueError: accountIssueResult.error,
    documentationError: documentation.error,
    rows: rows,
  };
}

function collectMerchantAccountIssues_(accountId) {
  const issues = [];
  let pageToken = '';
  try {
    do {
      const url = merchantAccountIssuesUrl_(accountId, pageToken);
      const response = googleJson_(
        url,
        { method: 'get' },
        'Merchant account issues',
      );
      (response.accountIssues || []).forEach(function (issue) {
        issues.push(issue);
      });
      pageToken = response.nextPageToken || '';
    } while (pageToken);
    return { issues: issues, error: '' };
  } catch (error) {
    return {
      issues: issues,
      error: String(error && error.message || error),
    };
  }
}

function merchantAccountIssuesUrl_(accountId, pageToken) {
  let url =
    'https://merchantapi.googleapis.com/accounts/v1/accounts/' +
    accountId +
    '/issues?language_code=ja-JP&time_zone=' +
    encodeURIComponent('Asia/Tokyo') +
    '&page_size=100';
  if (pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
  return url;
}

function merchantResolutionProductId_(productId) {
  const parts = String(productId || '').split('~');
  if (String(parts[0] || '').toLowerCase() === 'online' && parts.length >= 4) {
    parts.shift();
  }
  const normalized = parts.join('~');
  if (!normalized) return '';
  return Utilities.base64EncodeWebSafe(normalized).replace(/=+$/g, '');
}

function merchantUrlsInObject_(value, output) {
  const urls = output || [];
  if (typeof value === 'string') {
    if (/^https:\/\//i.test(value) && urls.indexOf(value) < 0) {
      urls.push(value);
    }
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach(function (item) {
      merchantUrlsInObject_(item, urls);
    });
    return urls;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(function (key) {
      merchantUrlsInObject_(value[key], urls);
    });
  }
  return urls;
}

function collectMerchantProductDocumentation_(accountId, products) {
  const urlsByProductAndCode = {};
  const errors = [];
  const targets = (products || []).filter(function (product) {
    return product.itemIssues.some(function (issue) {
      return issue.resolution === 'MERCHANT_ACTION';
    });
  }).slice(0, 50);

  targets.forEach(function (product) {
    const encodedId = merchantResolutionProductId_(product.id);
    if (!encodedId) return;
    try {
      const response = googleJson_(
        'https://merchantapi.googleapis.com/issueresolution/v1/accounts/' +
          accountId +
          '/products/' + encodedId +
          ':renderproductissues?languageCode=ja-JP&timeZone=Asia%2FTokyo',
        {
          method: 'post',
          payload: {
            contentOption: 'PRE_RENDERED_HTML',
            userInputActionOption: 'REDIRECT_TO_MERCHANT_CENTER',
          },
        },
        'Merchant product issue resolution',
      );
      if (product.itemIssues.length === 1) {
        const urls = merchantUrlsInObject_(response, []);
        if (urls.length) {
          urlsByProductAndCode[
            product.id + '|' + product.itemIssues[0].code
          ] = urls[0];
        }
      }
    } catch (error) {
      errors.push(
        product.id + ': ' + String(error && error.message || error),
      );
    }
  });
  return {
    urls: urlsByProductAndCode,
    error: errors.join(' | ').slice(0, 5000),
  };
}

function merchantAccountIssueDetails_(issue) {
  const source = issue && typeof issue === 'object' ? issue : {};
  const contexts = [];
  const countries = [];
  (source.impactedDestinations || []).forEach(function (destination) {
    if (destination.reportingContext) {
      contexts.push(destination.reportingContext);
    }
    (destination.impacts || []).forEach(function (impact) {
      if (impact.regionCode) {
        countries.push(
          String(impact.severity || 'IMPACT') + ':' + impact.regionCode,
        );
      }
    });
  });
  return {
    code: String(source.name || 'ACCOUNT_ISSUE').split('/').pop(),
    title: String(source.title || ''),
    severity: String(source.severity || ''),
    reportingContexts: merchantUniqueStrings_(contexts).join(', '),
    countries: merchantUniqueStrings_(countries).join(', '),
    documentationUrl: String(source.documentationUri || ''),
    detail: String(source.detail || ''),
    rawJson: JSON.stringify(source),
  };
}

function merchantPriceText_(price) {
  if (!price || price.amountMicros === undefined) return '';
  const amount = Number(price.amountMicros || 0) / 1000000;
  return amount + ' ' + String(price.currencyCode || '');
}

function merchantContextStatuses_(product) {
  const values = [];
  (product.statusPerReportingContext || []).forEach(function (context) {
    const prefix = String(context.reportingContext || 'UNKNOWN');
    (context.approvedCountries || []).forEach(function (country) {
      values.push(prefix + ':approved:' + country);
    });
    (context.pendingCountries || []).forEach(function (country) {
      values.push(prefix + ':pending:' + country);
    });
    (context.disapprovedCountries || []).forEach(function (country) {
      values.push(prefix + ':disapproved:' + country);
    });
  });
  return merchantUniqueStrings_(values).join(', ');
}

function buildMerchantIssueRows_(
  checkedAt,
  products,
  accountIssues,
  documentationUrls,
) {
  const counts = {};
  (products || []).forEach(function (product) {
    product.itemIssues.forEach(function (issue) {
      counts[issue.code] = Number(counts[issue.code] || 0) + 1;
    });
  });
  const rows = [];
  (products || []).forEach(function (product) {
    const issues = product.itemIssues.length
      ? product.itemIssues
      : [
          {
            code: 'NO_ITEM_ISSUES_RETURNED',
            canonicalAttribute: '',
            severity: '',
            resolution: '',
            reportingContexts: '',
            countries: '',
            rawJson: '{}',
          },
        ];
    issues.forEach(function (issue) {
      rows.push([
        checkedAt,
        'product',
        product.id,
        product.offerId,
        product.title,
        product.brand,
        product.availability,
        merchantPriceText_(product.price),
        product.status,
        merchantContextStatuses_(product),
        issue.code,
        issue.canonicalAttribute,
        issue.severity,
        issue.resolution,
        issue.reportingContexts,
        issue.countries,
        documentationUrls[product.id + '|' + issue.code] || '',
        counts[issue.code] || 0,
        issue.rawJson,
      ]);
    });
  });
  (accountIssues || []).forEach(function (issue) {
    const details = merchantAccountIssueDetails_(issue);
    rows.push([
      checkedAt,
      'account',
      '',
      '',
      details.title,
      '',
      '',
      '',
      details.severity,
      '',
      details.code,
      '',
      details.severity,
      '',
      details.reportingContexts,
      details.countries,
      details.documentationUrl,
      '',
      details.rawJson,
    ]);
  });
  return rows;
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
  sheet.getRange('C:S').setWrap(true);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 230);
  sheet.setColumnWidth(5, 320);
  sheet.setColumnWidth(10, 260);
  sheet.setColumnWidth(11, 250);
  sheet.setColumnWidth(15, 180);
  sheet.setColumnWidth(16, 180);
  sheet.setColumnWidth(17, 260);
  sheet.setColumnWidth(19, 420);

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
        accountIssues: result.accountIssues.length,
        issueRows: result.issueRows,
        accountIssueError: result.accountIssueError,
        documentationError: result.documentationError,
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
