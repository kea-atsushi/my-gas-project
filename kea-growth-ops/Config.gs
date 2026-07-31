/**
 * Kea. Growth Ops
 * Secrets are read only from Apps Script Properties.
 */
const KEA_DEFAULTS = Object.freeze({
  TIME_ZONE: 'Asia/Tokyo',
  STOREFRONT_ORIGIN: 'https://store.kea.co.jp',
  SHOPIFY_STORE_DOMAIN: 'kea-store-7787.myshopify.com',
  SHOPIFY_API_VERSION: '2026-07',
  SEARCH_CONSOLE_SITE_URL: 'sc-domain:kea.co.jp',
  SEARCH_CONSOLE_SITEMAP_URL: 'https://store.kea.co.jp/sitemap.xml',
  GOOGLE_ADS_API_VERSION: 'v25',
  OPENAI_MODEL: 'gpt-5.6-luna',
  AI_MODE: 'RULES',
  DEFAULT_COGS_RATE: '',
  DAILY_REPORT_HOUR: '7',
  WEEKLY_REPORT_HOUR: '8',
  REPORT_LOOKBACK_DAYS: '30',
  ADS_MUTATION_MODE: 'QUEUE_ONLY',
});

const KEA_REQUIRED_SHEETS = Object.freeze({
  Daily: [
    'date',
    'shopifySales',
    'shopifyOrders',
    'estimatedCogs',
    'adCost',
    'contributionProfit',
    'roas',
    'cpa',
    'cv',
    'ctr',
    'cpc',
    'ga4Sessions',
    'ga4Revenue',
    'gscClicks',
    'gscImpressions',
    'gscCtr',
    'gscPosition',
    'merchantApproved',
    'merchantDisapproved',
    'status',
    'report',
    'updatedAt',
  ],
  Products: [
    'periodEnd',
    'handle',
    'vendor',
    'title',
    'units',
    'revenue',
    'estimatedCogs',
    'status',
  ],
  Ads: [
    'periodEnd',
    'campaignId',
    'campaign',
    'status',
    'channel',
    'impressions',
    'clicks',
    'cost',
    'conversions',
    'conversionValue',
    'ctr',
    'cpc',
    'cpa',
    'roas',
  ],
  SearchConsole: [
    'periodEnd',
    'query',
    'page',
    'clicks',
    'impressions',
    'ctr',
    'position',
  ],
  Merchant: [
    'checkedAt',
    'offerId',
    'title',
    'brand',
    'availability',
    'status',
    'issues',
  ],
  Recommendations: [
    'createdAt',
    'cadence',
    'category',
    'priority',
    'target',
    'evidence',
    'recommendation',
    'approvalStatus',
  ],
  ProductAutomation: [
    'detectedAt',
    'productId',
    'handle',
    'productUrl',
    'seoStatus',
    'merchantRefresh',
    'sitemapSubmit',
    'urlInspection',
    'adsAction',
    'manualAction',
  ],
  RunLog: ['startedAt', 'handler', 'status', 'message', 'finishedAt'],
  Config: ['key', 'value', 'required', 'description'],
});

function keaConfig_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const config = Object.assign({}, KEA_DEFAULTS, properties);
  config.DEFAULT_COGS_RATE = nullableNumber_(config.DEFAULT_COGS_RATE);
  config.DAILY_REPORT_HOUR = Number(config.DAILY_REPORT_HOUR || 7);
  config.WEEKLY_REPORT_HOUR = Number(config.WEEKLY_REPORT_HOUR || 8);
  config.REPORT_LOOKBACK_DAYS = Number(config.REPORT_LOOKBACK_DAYS || 30);
  return config;
}

function nullableNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configured_(config, keys) {
  return keys.every(function (key) {
    return String(config[key] || '').trim() !== '';
  });
}

function setupKeaGrowthOps() {
  return withScriptLock_('setupKeaGrowthOps', function () {
    const config = keaConfig_();
    let spreadsheetId = String(config.DASHBOARD_SPREADSHEET_ID || '').trim();
    if (!spreadsheetId) {
      const spreadsheet = SpreadsheetApp.create('Kea_集客最適化ダッシュボード');
      spreadsheetId = spreadsheet.getId();
      PropertiesService.getScriptProperties().setProperty(
        'DASHBOARD_SPREADSHEET_ID',
        spreadsheetId,
      );
    }
    initializeSheets_(spreadsheetId);
    writeConfigGuide_(spreadsheetId);
    installKeaGrowthTriggers();
    return {
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + spreadsheetId,
      triggerHandlers: managedTriggerHandlers_(),
    };
  });
}

function writeConfigGuide_(spreadsheetId) {
  const rows = [
    ['DASHBOARD_SPREADSHEET_ID', spreadsheetId, '自動設定', '集約先スプレッドシート'],
    ['REPORT_EMAILS', '', '必須', '日次・週次レポート送信先。カンマ区切り'],
    ['SHOPIFY_ADMIN_ACCESS_TOKEN', '', 'いずれか', 'read_orders/read_products/read_inventory権限'],
    ['SHOPIFY_CLIENT_ID', '', 'いずれか', 'Shopify Client Credentials'],
    ['SHOPIFY_CLIENT_SECRET', '', 'いずれか', 'Shopify Client Credentials'],
    ['GA4_PROPERTY_ID', '', '必須', 'GA4数値プロパティID'],
    ['GOOGLE_ADS_CUSTOMER_ID', '', '必須', 'ハイフンなし'],
    ['GOOGLE_ADS_DEVELOPER_TOKEN', '', '必須', 'Google Ads API開発者トークン'],
    ['GOOGLE_ADS_LOGIN_CUSTOMER_ID', '', '任意', 'MCC経由時のみ。ハイフンなし'],
    ['MERCHANT_ACCOUNT_ID', '', '必須', 'Merchant Center ID'],
    ['MERCHANT_DATA_SOURCE_ID', '', '任意', 'ファイル型データソースを即時取得する場合'],
    ['MERCHANT_SHOPIFY_CONNECTED_AT', '', '任意', 'Shopify接続日時。ISO 8601。未設定時は監視開始時刻を基準'],
    ['SEARCH_CONSOLE_SITE_URL', KEA_DEFAULTS.SEARCH_CONSOLE_SITE_URL, '必須', 'URL-prefixまたはsc-domain'],
    ['GBP_ACCOUNT_ID', '', 'MEO接続時', '候補確認後のaccounts/始まりのID'],
    ['GBP_LOCATION_ID', '', 'MEO接続時', '候補確認後のlocations/始まりのID'],
    ['OPENAI_API_KEY', '', '任意', 'AI_MODE=OPENAI時のみ'],
    ['OPENAI_MODEL', KEA_DEFAULTS.OPENAI_MODEL, '任意', '低コスト日次レポート用'],
    ['AI_MODE', KEA_DEFAULTS.AI_MODE, '必須', 'RULESまたはOPENAI'],
    ['DEFAULT_COGS_RATE', '', '推奨', '0.0〜1.0。商品原価が読めない場合の推定率'],
    ['ADS_MUTATION_MODE', 'QUEUE_ONLY', '固定推奨', '自動予算変更・停止を禁止'],
  ];
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Config');
  replaceSheetRows_(sheet, KEA_REQUIRED_SHEETS.Config, rows);
  sheet.autoResizeColumns(1, KEA_REQUIRED_SHEETS.Config.length);
}

function getDashboardSpreadsheet_() {
  const spreadsheetId = String(
    keaConfig_().DASHBOARD_SPREADSHEET_ID || '',
  ).trim();
  if (!spreadsheetId) {
    throw new Error('setupKeaGrowthOps()を先に実行してください。');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function dateKey_(date) {
  return Utilities.formatDate(date, KEA_DEFAULTS.TIME_ZONE, 'yyyy-MM-dd');
}

function isoTimestamp_(date) {
  return Utilities.formatDate(
    date || new Date(),
    KEA_DEFAULTS.TIME_ZONE,
    "yyyy-MM-dd'T'HH:mm:ssXXX",
  );
}

function dateDaysAgo_(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function startOfDay_(date) {
  const text = Utilities.formatDate(
    date,
    KEA_DEFAULTS.TIME_ZONE,
    'yyyy-MM-dd',
  );
  return new Date(text + 'T00:00:00+09:00');
}
