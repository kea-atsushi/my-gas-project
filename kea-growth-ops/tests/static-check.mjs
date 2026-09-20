import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const gasFiles = fs
  .readdirSync(root)
  .filter((name) => name.endsWith(".gs"))
  .sort();

assert.ok(gasFiles.length >= 8, "expected Apps Script source files");
const context = vm.createContext({
  console,
  Date,
  Intl,
  JSON,
  Math,
  Number,
  Object,
  Set,
  String,
  Array,
  Error,
  RegExp,
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, input) {
      return Array.from(
        crypto.createHash("sha256").update(String(input)).digest(),
        (value) => (value > 127 ? value - 256 : value),
      );
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes.map((value) => value & 255)).toString(
        "base64url",
      );
    },
    sleep() {},
    formatDate(date, timeZone, format) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(date))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      const dateText = `${parts.year}-${parts.month}-${parts.day}`;
      if (format === "yyyy-MM-dd") return dateText;
      if (format === "H") return String(Number(parts.hour));
      return `${dateText}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;
    },
  },
});
for (const file of gasFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  new vm.Script(source, { filename: file }).runInContext(context);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "appsscript.json"), "utf8"),
);
assert.equal(manifest.timeZone, "Asia/Tokyo");
assert.equal(manifest.runtimeVersion, "V8");
for (const scope of [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/content",
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/business.manage",
]) {
  assert.ok(manifest.oauthScopes.includes(scope), `missing scope ${scope}`);
}
assert.equal(manifest.webapp.access, "MYSELF");

const allSource = gasFiles
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
for (const required of [
  "LockService.getScriptLock()",
  "runDailyGrowthReport",
  "runWeeklyGrowthProposal",
  "monitorNewProducts",
  "submitSearchConsoleSitemap_",
  "inspectSearchConsoleUrl_",
  "googleAds:searchStream",
  "merchantapi.googleapis.com/reports/v1",
  "api.openai.com/v1/responses",
  "ADS_MUTATION_MODE",
  "承認待ち",
  "MerchantIssues",
  "runMerchantHealthWatch",
  "runSeoHealthAudit",
  "runMeoHealthAudit",
  "runGrowthHealthWatch",
  "MerchantHealth",
  "SEOHealth",
  "MEOHealth",
  "GbpConnection",
  "businessprofileperformance.googleapis.com/v1",
  "unavailable/pending",
  "ShopifySkuAudit",
  "runShopifySkuAudit",
  "verifyGrowthOpsActionableAlertsNow",
  "custom\", key: \"product_code",
  "selectedOptions",
]) {
  assert.ok(allSource.includes(required), `missing required behavior: ${required}`);}
assert.ok(
  !/OPENAI_API_KEY\s*[:=]\s*['"][^'"]+['"]/.test(allSource),
  "OpenAI key must not be committed",
);
assert.ok(
  !/SHOPIFY_ADMIN_ACCESS_TOKEN\s*[:=]\s*['"][^'"]+['"]/.test(allSource),
  "Shopify token must not be committed",
);
const googleAdsHttpSource = fs.readFileSync(
  path.join(root, "Http.gs"),
  "utf8",
);
assert.ok(
  !googleAdsHttpSource.includes(["developer", "token"].join("-")),
  "Google Ads requests must use Cloud-project access without the legacy header",
);
assert.ok(
  !allSource.includes(["GOOGLE", "ADS", "DEVELOPER", "TOKEN"].join("_")),
  "Google Ads configuration must not require the legacy token",
);
const originalScriptApp = context.ScriptApp;
const originalUrlFetchApp = context.UrlFetchApp;
const googleAdsRequests = [];
context.ScriptApp = {
  getOAuthToken() {
    return "oauth-access-token";
  },
};
context.UrlFetchApp = {
  fetch(url, options) {
    googleAdsRequests.push({ url, options });
    return {
      getResponseCode() {
        return 200;
      },
      getContentText() {
        return JSON.stringify([
          { results: [{ customer: { id: "1234567890" } }] },
        ]);
      },
    };
  },
};
const googleAdsResult = context.googleAdsSearch_(
  {
    GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: "987-654-3210",
    GOOGLE_ADS_API_VERSION: "v25",
  },
  "SELECT customer.id FROM customer LIMIT 1",
);
assert.equal(googleAdsResult.available, true);
assert.equal(googleAdsResult.rows[0].customer.id, "1234567890");
assert.equal(googleAdsRequests.length, 1);
assert.equal(
  googleAdsRequests[0].url,
  "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream",
);
assert.equal(
  googleAdsRequests[0].options.headers.Authorization,
  "Bearer oauth-access-token",
);
assert.equal(
  googleAdsRequests[0].options.headers["login-customer-id"],
  "9876543210",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    googleAdsRequests[0].options.headers,
    ["developer", "token"].join("-"),
  ),
  false,
);
if (originalScriptApp === undefined) delete context.ScriptApp;
else context.ScriptApp = originalScriptApp;
if (originalUrlFetchApp === undefined) delete context.UrlFetchApp;
else context.UrlFetchApp = originalUrlFetchApp;
const skuReadOnlySource = [
  fs.readFileSync(path.join(root, "Collectors.gs"), "utf8"),
  fs.readFileSync(path.join(root, "ShopifySkuHealth.gs"), "utf8"),
].join("\n");
assert.ok(
  !skuReadOnlySource.includes("write_products"),
  "SKU audit must stay read-only",
);
assert.ok(
  !skuReadOnlySource.includes("productVariantsBulkUpdate"),
  "SKU audit must not update Shopify variants",
);

const collectorSource = fs.readFileSync(
  path.join(root, "Collectors.gs"),
  "utf8",
);
const skuCollectorStart = collectorSource.indexOf(
  "function collectShopifySkuCatalogPage_",
);
const skuCollectorEnd = collectorSource.indexOf(
  "function auditShopifyProductSeo_",
  skuCollectorStart,
);
assert.ok(skuCollectorStart >= 0 && skuCollectorEnd > skuCollectorStart);
const skuCollectorSource = collectorSource.slice(
  skuCollectorStart,
  skuCollectorEnd,
);
assert.ok(
  skuCollectorSource.includes(
    'productVariants(first: 100, after: $after, sortKey: ID, query: $query)',
  ),
);
assert.ok(!skuCollectorSource.includes("product_status:"));
assert.ok(!skuCollectorSource.includes("status:active"));
assert.ok(skuCollectorSource.includes("pageInfo { hasNextPage endCursor }"));
assert.ok(skuCollectorSource.includes("partitionSize = 20000"));
assert.ok(skuCollectorSource.includes("KeaShopifySkuCatalogMaxId"));
assert.ok(skuCollectorSource.includes("reverse: true"));
assert.ok(skuCollectorSource.includes("shopifySkuIdRangeQuery_"));
assert.ok(skuCollectorSource.includes("upperVariantId"));
assert.ok(skuCollectorSource.includes("collectShopifySkuCatalogPage_"));
assert.ok(skuCollectorSource.includes("Utilities.sleep"));

const skuHealthSource = fs.readFileSync(
  path.join(root, "ShopifySkuHealth.gs"),
  "utf8",
);
assert.ok(
  !/\.split\(\s*['"]-['"]\s*\)/.test(skuHealthSource),
  "SKU must not be split on hyphens",
);
assert.ok(skuHealthSource.includes("writeShopifySkuSheetInChunks_"));
assert.ok(skuHealthSource.includes("_ShopifySkuAuditStaging"));
assert.ok(skuHealthSource.includes("_ShopifySkuAuditBackup"));
assert.ok(skuHealthSource.includes("recoverShopifySkuPublishIfNeeded_"));
assert.ok(skuHealthSource.includes("recoverShopifySkuPublishBeforeAudit_"));
assert.ok(skuHealthSource.includes("shopifySkuSpreadsheetId_"));
assert.ok(skuHealthSource.includes("backupFingerprint"));
assert.ok(skuHealthSource.includes("PUBLISHING WAL\u6c38\u7d9a\u5316\u5931\u6557"));
assert.ok(skuHealthSource.includes("shopifySkuPublishReserveMs_"));
assert.ok(skuHealthSource.includes("phase: 'BACKUP_READY'"));
assert.ok(skuHealthSource.includes("wal.phase = 'PUBLISHING'"));
assert.ok(skuHealthSource.includes("wal.phase = 'COMMITTED'"));
assert.ok(skuHealthSource.includes("{ contentsOnly: true }"));
assert.ok(skuHealthSource.includes("live.getSheetId() !== liveSheetId"));
assert.ok(!skuHealthSource.includes(".setName("));
assert.ok(!skuHealthSource.includes("deleteSheet("));
assert.ok(skuHealthSource.includes("PRODUCT_CODE_EXPECTED_VENDOR_MISMATCH"));
assert.ok(skuHealthSource.includes("KEA_SHOPIFY_SKU_CHECKPOINT_SHEET"));
assert.ok(skuCollectorSource.includes("shopifySkuCheckpointCatalogResult_"));
assert.ok(skuCollectorSource.includes("executionDeadlineAtMs"));
assert.ok(skuHealthSource.includes("PRODUCT_CODE_DUPLICATE"));
assert.ok(skuHealthSource.includes("CROSS_PRODUCT_SKU_DUPLICATE"));

const healthCommonSource = fs.readFileSync(
  path.join(root, "HealthCommon.gs"),
  "utf8",
);
assert.ok(healthCommonSource.includes("KEA_HEALTH_POST_SKU_RESERVE_MS"));
assert.ok(
  healthCommonSource.indexOf("results.MERCHANT") <
    healthCommonSource.indexOf("results.SHOPIFY_SKU"),
);
assert.ok(
  healthCommonSource.includes(
    "name === KEA_SHOPIFY_SKU_AUDIT_SHEET && !created",
  ),
);

const dashboard = fs.readFileSync(path.join(root, "Dashboard.html"), "utf8");
assert.ok(dashboard.includes("@media (max-width: 430px)"));
assert.ok(dashboard.includes("google.script.run"));
assert.ok(dashboard.includes("貢献利益"));
assert.ok(dashboard.includes("人気ブランド"));
assert.ok(dashboard.includes("brandRows"));
assert.ok(dashboard.includes("Merchant"));
assert.ok(dashboard.includes("SEO"));
assert.ok(dashboard.includes("MEO"));
assert.ok(dashboard.includes("Shopify SKU監査"));
assert.ok(dashboard.includes("min-height: calc(100svh - 20px)"));
const dashboardScript = dashboard.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(dashboardScript, "dashboard script must exist");
new vm.Script(dashboardScript[1], { filename: "Dashboard.inline.js" });

const originalReadDashboardData = context.readDashboardData_;
context.readDashboardData_ = () => ({
  generatedAt: new Date("2026-08-23T00:00:00.000Z"),
  nested: {
    updatedAt: new Date("2026-08-23T00:01:00.000Z"),  },
});
const clientDashboard = context.getDashboardData();
assert.equal(clientDashboard.generatedAt, "2026-08-23T00:00:00.000Z");
assert.equal(
  clientDashboard.nested.updatedAt,
  "2026-08-23T00:01:00.000Z",
);
context.readDashboardData_ = originalReadDashboardData;

assert.equal(context.safeDivide_(100, 0), 0);
const productAudit = context.auditShopifyProductSeo_(
  {
    id: "gid://shopify/Product/1",
    title: "TEST",
    handle: "test",
    vendor: "",
    descriptionHtml: "<p>short</p>",
    seo: {},
    variants: { nodes: [{ sku: "" }] },
    featuredMedia: null,
  },
  "https://store.kea.co.jp",
);
assert.equal(productAudit.status, "要確認");
assert.ok(productAudit.issues.includes("SKU空欄"));
assert.equal(context.normalizeSkuPart_(" Ｆｒｅｅ "), "FREE");
assert.equal(
  context.buildExpectedSku_("AB-123", "one size", "black"),
  "AB-123-ONE-SIZE-BLACK",
);
const defaultOptions = context.resolveSkuSelectedOptions_([
  { name: "Title", value: "Default Title" },
]);
assert.equal(defaultOptions.size, "FREE");
assert.equal(defaultOptions.color, "ONECOLOR");
const skuAudit = context.buildShopifySkuAudit_([
  {
    id: "variant-1",
    title: "M / BLACK",
    sku: "2059242-M-BLACK",
    selectedOptions: [
      { name: "Color", value: "black" },
      { name: "Size", value: "M" },
    ],
    product: {
      id: "product-1",
      title: "TEST",
      handle: "test",
      vendor: "TEST",
      status: "DRAFT",
      productCode: { value: "2059242" },
    },
  },
], "2026-08-02T12:00:00+09:00");
assert.equal(skuAudit.summary.productCount, 1);
assert.equal(skuAudit.summary.variantCount, 1);
assert.equal(skuAudit.summary.draftProductCount, 1);
assert.equal(skuAudit.summary.issueVariantCount, 0);
assert.equal(skuAudit.rows[0].productCode, "2059242");
assert.equal(skuAudit.rows[0].size, "M");
assert.equal(skuAudit.rows[0].color, "BLACK");
assert.equal(context.shopifySkuSheetCell_("=1+1"), "'=1+1");

const actionableAlertsVerification =
  context.verifyGrowthOpsActionableAlertsNow();
assert.equal(actionableAlertsVerification.status, "passed");
assert.equal(
  actionableAlertsVerification.merchant603to602.level,
  "対応不要",
);
assert.equal(
  actionableAlertsVerification.merchantDisapprovalIncrease.level,
  "要対応",
);
assert.equal(actionableAlertsVerification.seo.spamExcluded, true);
assert.equal(
  context.shopifySkuSheetRows_(skuAudit)[0].length,
  new vm.Script("KEA_HEALTH_SHEETS.ShopifySkuAudit.length").runInContext(
    context,
  ),
  "ShopifySkuAudit rows must match the dedicated sheet header",
);
let mockMaxRows = 1000;
let mockMaxColumns = 10;
const mockWriteSizes = [];
const mockSheet = {
  getMaxRows() {
    return mockMaxRows;
  },
  getMaxColumns() {
    return mockMaxColumns;
  },
  insertRowsAfter(_row, count) {
    mockMaxRows += count;
  },
  insertColumnsAfter(_column, count) {
    mockMaxColumns += count;
  },
  getRange(_row, _column, _rowCount, _columnCount) {
    return {
      setValues(values) {
        mockWriteSizes.push(values.length);
      },
    };
  },
};
const auditHeaders = Array.from({ length: 19 }, (_, index) => `h${index}`);
const shopifySkuHeaders = new vm.Script(
  "Array.from(KEA_HEALTH_SHEETS.ShopifySkuAudit)",
).runInContext(context);
const auditRows = Array.from({ length: 1201 }, () =>
  Array.from({ length: 19 }, () => ""),
);
context.writeShopifySkuSheetInChunks_(mockSheet, auditHeaders, auditRows);
assert.equal(mockMaxRows, 1202);
assert.equal(mockMaxColumns, 19);
assert.deepEqual(mockWriteSizes, [1, 500, 500, 201]);

function createSkuPublishWorkbook_(failPublishOnce) {
  let nextSheetId = 200;
  const sheets = [];
  const state = { failPublishOnce: !!failPublishOnce, flushes: 0 };

  function createSheet_(name, fixedId) {
    let maxRows = 10;
    let maxColumns = 22;
    let values = Array.from({ length: maxRows }, () =>
      Array(maxColumns).fill(""),
    );
    let formulas = Array.from({ length: maxRows }, () =>
      Array(maxColumns).fill(""),
    );    const chart = { id: `${name}-chart` };
    const protection = { id: `${name}-protection` };

    function addRows_(count) {
      for (let index = 0; index < count; index += 1) {
        values.push(Array(maxColumns).fill(""));
        formulas.push(Array(maxColumns).fill(""));
      }
      maxRows += count;
    }

    function addColumns_(count) {
      values.forEach((row) => row.push(...Array(count).fill("")));
      formulas.forEach((row) => row.push(...Array(count).fill("")));
      maxColumns += count;
    }

    const sheet = {
      name,
      id: fixedId || nextSheetId++,
      hidden: false,
      getName() {
        return name;
      },
      getSheetId() {
        return this.id;
      },
      getMaxRows() {
        return maxRows;
      },
      getMaxColumns() {
        return maxColumns;
      },
      insertRowsAfter(_after, count) {
        addRows_(count);
      },
      insertColumnsAfter(_after, count) {
        addColumns_(count);
      },
      hideSheet() {
        this.hidden = true;
      },
      clearContents() {
        values = Array.from({ length: maxRows }, () =>
          Array(maxColumns).fill(""),
        );
        formulas = Array.from({ length: maxRows }, () =>
          Array(maxColumns).fill(""),
        );
      },
      getLastRow() {
        for (let row = maxRows - 1; row >= 0; row -= 1) {
          if (
            values[row].some((value) => value !== "") ||
            formulas[row].some((value) => value !== "")
          ) {
            return row + 1;
          }
        }
        return 0;
      },
      getCharts() {
        return [chart];
      },
      getProtections() {
        return [protection];
      },
      getRange(row, column, rowCount = 1, columnCount = 1) {
        const firstRow = row - 1;
        const firstColumn = column - 1;
        const range = {
          sheet,
          row,
          column,
          rowCount,
          columnCount,
          setValues(input) {
            for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
              for (
                let columnOffset = 0;
                columnOffset < columnCount;
                columnOffset += 1
              ) {
                values[firstRow + rowOffset][firstColumn + columnOffset] =
                  input[rowOffset][columnOffset];
                formulas[firstRow + rowOffset][firstColumn + columnOffset] = "";
              }
            }
            return this;
          },
          setValue(input) {
            return this.setValues([[input]]);
          },
          setFormula(input) {
            formulas[firstRow][firstColumn] = input;
            values[firstRow][firstColumn] = "";
            return this;
          },
          setFormulas(input) {
            for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
              for (
                let columnOffset = 0;
                columnOffset < columnCount;
                columnOffset += 1
              ) {
                formulas[firstRow + rowOffset][firstColumn + columnOffset] =
                  input[rowOffset][columnOffset];
                values[firstRow + rowOffset][firstColumn + columnOffset] = "";
              }
            }
            return this;
          },
          getValues() {
            return Array.from({ length: rowCount }, (_, rowOffset) =>
              Array.from(
                { length: columnCount },
                (_, columnOffset) =>
                  values[firstRow + rowOffset][firstColumn + columnOffset],
              ),
            );          },
          getValue() {
            return this.getValues()[0][0];
          },
          getFormulas() {
            return Array.from({ length: rowCount }, (_, rowOffset) =>
              Array.from(
                { length: columnCount },
                (_, columnOffset) =>
                  formulas[firstRow + rowOffset][firstColumn + columnOffset],
              ),
            );
          },
          clearContent() {
            for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
              for (
                let columnOffset = 0;
                columnOffset < columnCount;
                columnOffset += 1
              ) {
                values[firstRow + rowOffset][firstColumn + columnOffset] = "";
                formulas[firstRow + rowOffset][firstColumn + columnOffset] = "";
              }
            }
            return this;
          },
          copyTo(target, options) {
            assert.equal(options && options.contentsOnly, true);
            if (
              state.failPublishOnce &&
              sheet.getName() === "_ShopifySkuAuditStaging" &&
              target.sheet.getName() === "ShopifySkuAudit"
            ) {
              state.failPublishOnce = false;
              throw new Error("injected publish failure");
            }
            for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
              for (
                let columnOffset = 0;
                columnOffset < columnCount;
                columnOffset += 1
              ) {
                target.sheet._setCell(
                  target.row + rowOffset,
                  target.column + columnOffset,
                  values[firstRow + rowOffset][firstColumn + columnOffset],
                  formulas[firstRow + rowOffset][firstColumn + columnOffset],
                );
              }
            }
          },
        };
        return range;
      },
      _setCell(row, column, value, formula) {
        values[row - 1][column - 1] = value;
        formulas[row - 1][column - 1] = formula;
      },
      snapshot(rowCount, columnCount) {
        return {
          values: this.getRange(1, 1, rowCount, columnCount).getValues(),
          formulas: this.getRange(1, 1, rowCount, columnCount).getFormulas(),
        };
      },
    };
    sheets.push(sheet);
    return sheet;
  }

  const live = createSheet_("ShopifySkuAudit", 101);
  live.getRange(1, 1).setValue("old-header");
  live.getRange(2, 1).setValue("old-row");
  live.getRange(3, 2).setFormula("=A2");
  live.getRange(3, 20).setFormula("=ShopifySkuAudit!A2");
  const spreadsheet = {
    getId() {
      return "mock-spreadsheet-id";
    },
    getSheetByName(name) {
      return sheets.find((sheet) => sheet.getName() === name) || null;
    },
    getSheetById(id) {
      return sheets.find((sheet) => sheet.getSheetId() === Number(id)) || null;
    },
    getSheets() {
      return sheets.slice();
    },
    insertSheet(name) {
      return createSheet_(name);
    },
  };
  return { spreadsheet, live, state };
}

function createScriptProperties_(initialValues) {
  const values = new Map(Object.entries(initialValues || {}));
  return {
    values,
    service: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return values.has(key) ? values.get(key) : null;
          },
          setProperty(key, value) {
            values.set(key, String(value));
          },
          deleteProperty(key) {
            values.delete(key);
          },
        };
      },
    },
  };
}

const originalDashboardSpreadsheet = context.getDashboardSpreadsheet_;
const originalPropertiesService = context.PropertiesService;
const originalSpreadsheetApp = context.SpreadsheetApp;
try {  const successWorkbook = createSkuPublishWorkbook_(false);
  const successProperties = createScriptProperties_({
    KEA_SHOPIFY_SKU_LIVE_ROW_COUNT: "3",
  });
  context.getDashboardSpreadsheet_ = () => successWorkbook.spreadsheet;
  context.PropertiesService = successProperties.service;
  context.SpreadsheetApp = {
    flush() {
      successWorkbook.state.flushes += 1;
    },
  };
  const originalLiveId = successWorkbook.live.getSheetId();
  const originalChart = successWorkbook.live.getCharts()[0];
  const originalProtection = successWorkbook.live.getProtections()[0];
  context.writeShopifySkuAudit_(skuAudit);
  assert.equal(successWorkbook.live.getSheetId(), originalLiveId);
  assert.equal(successWorkbook.live.getName(), "ShopifySkuAudit");
  assert.equal(successWorkbook.live.getCharts()[0], originalChart);
  assert.equal(successWorkbook.live.getProtections()[0], originalProtection);
  assert.equal(
    successWorkbook.live.getRange(3, 20).getFormulas()[0][0],
    "=ShopifySkuAudit!A2",
  );
  assert.equal(
    successWorkbook.live.getRange(3, 2).getFormulas()[0][0],
    "=A2",
  );
  assert.equal(successWorkbook.live.getRange(2, 12).getValue(), "2059242");
  assert.equal(
    successProperties.values.get("KEA_SHOPIFY_SKU_LIVE_ROW_COUNT"),
    "2",
  );
  assert.equal(
    successProperties.values.has("KEA_SHOPIFY_SKU_PUBLISH_WAL_V1"),
    false,
  );

  const rollbackWorkbook = createSkuPublishWorkbook_(true);
  const rollbackProperties = createScriptProperties_({
    KEA_SHOPIFY_SKU_LIVE_ROW_COUNT: "3",
  });
  const beforeRollback = rollbackWorkbook.live.snapshot(3, 20);
  const rollbackLiveId = rollbackWorkbook.live.getSheetId();
  context.getDashboardSpreadsheet_ = () => rollbackWorkbook.spreadsheet;
  context.PropertiesService = rollbackProperties.service;
  context.SpreadsheetApp = {
    flush() {
      rollbackWorkbook.state.flushes += 1;
    },
  };
  assert.throws(
    () => context.writeShopifySkuAudit_(skuAudit),
    /injected publish failure/,
  );
  assert.equal(rollbackWorkbook.live.getSheetId(), rollbackLiveId);
  assert.deepEqual(rollbackWorkbook.live.snapshot(3, 20), beforeRollback);
  assert.equal(
    rollbackProperties.values.get("KEA_SHOPIFY_SKU_LIVE_ROW_COUNT"),
    "3",
  );
  assert.equal(
    rollbackProperties.values.has("KEA_SHOPIFY_SKU_PUBLISH_WAL_V1"),
    false,
  );

  const recoveryWorkbook = createSkuPublishWorkbook_(false);
  const recoveryProperties = createScriptProperties_({
    KEA_SHOPIFY_SKU_LIVE_ROW_COUNT: "3",
  });
  context.getDashboardSpreadsheet_ = () => recoveryWorkbook.spreadsheet;
  context.PropertiesService = recoveryProperties.service;
  context.SpreadsheetApp = {
    flush() {
      recoveryWorkbook.state.flushes += 1;
    },
  };
  const recoveryBackup = recoveryWorkbook.spreadsheet.insertSheet(
    "_ShopifySkuAuditBackup",
  );
  const recoveryStaging = recoveryWorkbook.spreadsheet.insertSheet(
    "_ShopifySkuAuditStaging",
  );
  context.copyShopifySkuSheetContents_(
    recoveryWorkbook.live,
    recoveryBackup,
    3,
    19,
  );
  const expectedRecovery = recoveryWorkbook.live.snapshot(3, 20);
  const healthRunKey = `KEA_HEALTH_SUCCESS_${context.dateKey_(new Date())}`;
  recoveryProperties.values.set(healthRunKey, "already-completed");
  recoveryProperties.values.set(
    "KEA_SHOPIFY_SKU_PUBLISH_WAL_V1",
    JSON.stringify({
      version: 1,
      phase: "PUBLISHING",
      spreadsheetId: "mock-spreadsheet-id",
      schemaFingerprint: context.shopifySkuValuesFingerprint_([
        shopifySkuHeaders,
      ]),
      backupFingerprint: context.shopifySkuSheetFingerprint_(
        recoveryBackup,
        3,
        19,
      ),
      liveSheetId: recoveryWorkbook.live.getSheetId(),
      stagingSheetId: recoveryStaging.getSheetId(),
      backupSheetId: recoveryBackup.getSheetId(),
      previousRowCountText: "3",
      newRowCount: 2,
      managedRowCount: 3,
      columnCount: 19,
      updatedAt: "2026-08-02T12:00:00+09:00",
    }),
  );
  recoveryWorkbook.live.getRange(1, 1, 3, 19).clearContent();
  const skippedHealth = context.runGrowthHealthWatchCore_(
    false,
    Date.now() + 330000,
  );  assert.equal(skippedHealth.status, "skipped");
  assert.deepEqual(recoveryWorkbook.live.snapshot(3, 20), expectedRecovery);
  assert.equal(
    recoveryProperties.values.has("KEA_SHOPIFY_SKU_PUBLISH_WAL_V1"),
    false,
  );

  const mismatchWorkbook = createSkuPublishWorkbook_(false);
  const mismatchProperties = createScriptProperties_({});
  const mismatchBackup = mismatchWorkbook.spreadsheet.insertSheet(
    "_ShopifySkuAuditBackup",
  );
  const mismatchStaging = mismatchWorkbook.spreadsheet.insertSheet(
    "_ShopifySkuAuditStaging",
  );
  context.copyShopifySkuSheetContents_(
    mismatchWorkbook.live,
    mismatchBackup,
    3,
    19,
  );
  mismatchProperties.values.set(
    "KEA_SHOPIFY_SKU_PUBLISH_WAL_V1",
    JSON.stringify({
      version: 1,
      phase: "PUBLISHING",
      spreadsheetId: "different-spreadsheet-id",
      schemaFingerprint: context.shopifySkuValuesFingerprint_([
        shopifySkuHeaders,
      ]),
      backupFingerprint: context.shopifySkuSheetFingerprint_(
        mismatchBackup,
        3,
        19,
      ),
      liveSheetId: mismatchWorkbook.live.getSheetId(),
      stagingSheetId: mismatchStaging.getSheetId(),
      backupSheetId: mismatchBackup.getSheetId(),
      previousRowCountText: "3",
      newRowCount: 2,
      managedRowCount: 3,
      columnCount: 19,
      updatedAt: "2026-08-02T12:00:00+09:00",
    }),
  );
  const beforeMismatch = mismatchWorkbook.live.snapshot(3, 20);
  context.getDashboardSpreadsheet_ = () => mismatchWorkbook.spreadsheet;
  context.PropertiesService = mismatchProperties.service;
  assert.throws(
    () => context.recoverShopifySkuPublishBeforeAudit_(),
    /spreadsheet ID/,
  );
  assert.deepEqual(mismatchWorkbook.live.snapshot(3, 20), beforeMismatch);
} finally {
  context.getDashboardSpreadsheet_ = originalDashboardSpreadsheet;
  context.PropertiesService = originalPropertiesService;
  context.SpreadsheetApp = originalSpreadsheetApp;
}

const dailyRecommendations = context.buildDailyRecommendations_(
  { missingSources: [] },
  {
    ads: {
      available: true,
      summary: { cost: 1200, conversions: 0 },
      campaigns: [
        {
          name: "一般検索",
          cost: 1200,
          conversions: 0,
          clicks: 40,
        },
      ],
    },
    merchant: { available: true, summary: { disapproved: 0 } },
    gsc: { available: true, rows: [] },
  },
);
assert.ok(
  dailyRecommendations.some((item) => item.category === "広告計測"),
);
assert.ok(
  dailyRecommendations.every((item) => item.approvalStatus === "承認待ち"),
);

const merchantIssue = context.merchantIssueDetails_({
  type: {
    code: "apparel_missing_brand",
    canonicalAttribute: "n:brand",
  },
  severity: {
    aggregatedSeverity: "DISAPPROVED",
    severityPerReportingContext: [
      {
        reportingContext: "FREE_LISTINGS",
        disapprovedCountries: ["JP"],
      },
    ],
  },
  resolution: "MERCHANT_ACTION",
});
assert.equal(merchantIssue.code, "apparel_missing_brand");
assert.equal(merchantIssue.canonicalAttribute, "n:brand");
assert.equal(merchantIssue.severity, "DISAPPROVED");
assert.equal(merchantIssue.resolution, "MERCHANT_ACTION");
assert.equal(merchantIssue.reportingContexts, "FREE_LISTINGS");
assert.equal(merchantIssue.countries, "disapproved:JP");

const merchantIncrease = context.merchantChangeEvents_(
  {
    totalProducts: 9,
    approved: 0,
    pending: 2,
    disapproved: 7,
    limited: 0,
  },
  {
    totalProducts: 7,
    approved: 0,
    pending: 0,    disapproved: 7,
    limited: 0,
  },
);
assert.ok(merchantIncrease.some((item) => item.includes("商品総数 7→9")));
assert.ok(merchantIncrease.some((item) => item.includes("審査中 0→2")));
assert.equal(
  context.healthNewAlertItems_([{ key: "same" }], ["same"]).length,
  0,
);
assert.equal(
  context.merchantIssueNeedsAction_({ resolution: "PENDING_PROCESSING" }),
  false,
);
assert.equal(
  context.merchantIssueNeedsAction_({ resolution: "MERCHANT_ACTION" }),
  true,
);
assert.equal(
  context.isOldKeaUrl_("https://www.kea.co.jp/store/products/list.php"),
  true,
);
assert.equal(
  context.seoCtrCandidate_({ impressions: 30, ctr: 0.019, position: 12 }),
  false,
);
assert.equal(
  context.seoCtrCandidate_({ impressions: 100, ctr: 0.019, position: 12 }),
  true,
);
assert.equal(context.meoConnectionState_("", true, "").available, false);
assert.equal(
  context.unansweredGbpReviews_([
    { reviewId: "new" },
    { reviewId: "done", reviewReply: { comment: "ok" } },
  ]).length,
  1,
);
const pendingReviewOutcome = context.meoConnectionOutcome_(
  { available: true, value: {}, error: "" },
  { available: true, value: { hasVoiceOfMerchant: true }, error: "" },
  {
    available: false,
    value: { reviews: [] },
    error:
      "GBP口コミ: Google My Business API has not been used in project 119772560648 before or it is disabled. HTTP 403",
  },
);
assert.equal(pendingReviewOutcome.status, "connected");
assert.equal(pendingReviewOutcome.reviewStatus, "unavailable/pending");
const gbpPerformanceSummary = context.gbpPerformanceSummary_({
  multiDailyMetricTimeSeries: [
    {
      dailyMetricTimeSeries: [
        {
          dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
          timeSeries: { datedValues: [{ value: "10" }, { value: "20" }] },
        },
        {
          dailyMetric: "WEBSITE_CLICKS",
          timeSeries: { datedValues: [{ value: "3" }] },
        },
      ],
    },
  ],
});
assert.equal(gbpPerformanceSummary.businessImpressions, 30);
assert.equal(gbpPerformanceSummary.websiteClicks, 3);
assert.equal(gbpPerformanceSummary.callClicks, 0);
const verificationFailureOutcome = context.meoConnectionOutcome_(
  { available: true, value: {}, error: "" },
  { available: false, value: null, error: "GBP確認状態: HTTP 403" },
  {
    available: false,
    value: { reviews: [] },
    error: "GBP口コミ: mybusiness.googleapis.com SERVICE_DISABLED 403",
  },
);
assert.equal(verificationFailureOutcome.status, "partial");
const unknownReviewFailureOutcome = context.meoConnectionOutcome_(
  { available: true, value: {}, error: "" },
  { available: true, value: { hasVoiceOfMerchant: true }, error: "" },
  {
    available: false,
    value: { reviews: [] },
    error: "GBP口コミ: HTTP 500",
  },
);
assert.equal(unknownReviewFailureOutcome.status, "partial");
assert.equal(unknownReviewFailureOutcome.reviewStatus, "unavailable");
const performanceFailureOutcome = context.meoConnectionOutcome_(
  { available: true, value: {}, error: "" },
  { available: true, value: { hasVoiceOfMerchant: true }, error: "" },
  { available: true, value: { reviews: [] }, error: "" },
  {
    available: false,
    value: { metrics: {} },
    error: "GBP Performance: HTTP 403",
  },
);
assert.equal(performanceFailureOutcome.status, "partial");

const scriptProperties = new Map();
context.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        return scriptProperties.has(key) ? scriptProperties.get(key) : null;
      },
      setProperty(key, value) {
        scriptProperties.set(key, String(value));
      },
      deleteProperty(key) {
        scriptProperties.delete(key);
      },
    };
  },
};
context.healthWriteJsonProperty_("KEA_HEALTH_STATE_SHOPIFY_SKU", {
  variantCount: 100,
  issueVariantCount: 10,
  skuBlankCount: 2,
  skuFormatCount: 3,
  duplicateSkuCount: 1,  duplicateProductCodeCount: 1,
  productCodeMissingCount: 4,
  optionIssueCount: 5,
});
const firstSkuFailureEvents = context.healthSourceEvents_("SHOPIFY_SKU", {
  available: false,
  state: { connectionStatus: "failed", reason: "temporary" },
  notificationIssues: [],
  reason: "temporary",
});
assert.equal(firstSkuFailureEvents.length, 0);
assert.equal(
  JSON.parse(scriptProperties.get("KEA_HEALTH_STATE_SHOPIFY_SKU")).variantCount,
  100,
);
context.writeFailedHealthRow_("SHOPIFY_SKU", "temporary");
assert.ok(scriptProperties.has("KEA_HEALTH_LAST_FAILURE_SHOPIFY_SKU"));
context.healthWriteJsonProperty_("KEA_HEALTH_ACTIVE_ALERTS_SHOPIFY_SKU", [
  "SHOPIFY_SKU|existing-alert",
]);
context.healthWriteJsonProperty_(
  "KEA_HEALTH_ACTIVE_RECOMMENDATIONS_SHOPIFY_SKU",
  ["SHOPIFY_SKU|existing-recommendation"],
);
const skuInProgressFinalization = context.finishHealthResults_({
  SHOPIFY_SKU: {
    source: "SHOPIFY_SKU",
    available: true,
    inProgress: true,
    connectionStatus: "in_progress",
    state: null,
    recommendations: [],
    notificationIssues: [],
  },
});
assert.equal(skuInProgressFinalization.events.length, 0);
assert.equal(
  JSON.parse(
    scriptProperties.get("KEA_HEALTH_STATE_SHOPIFY_SKU"),
  ).variantCount,
  100,
);
assert.deepEqual(
  JSON.parse(
    scriptProperties.get("KEA_HEALTH_ACTIVE_ALERTS_SHOPIFY_SKU"),
  ),
  ["SHOPIFY_SKU|existing-alert"],
);
assert.deepEqual(
  JSON.parse(
    scriptProperties.get(
      "KEA_HEALTH_ACTIVE_RECOMMENDATIONS_SHOPIFY_SKU",
    ),
  ),
  ["SHOPIFY_SKU|existing-recommendation"],
);
assert.equal(
  scriptProperties.get("KEA_HEALTH_FAILURE_STREAK_SHOPIFY_SKU"),
  "1",
);

const gasUnitResults = context.runKeaGrowthUnitTests();
assert.ok(Array.isArray(gasUnitResults), "Tests.gs must return results");
assert.equal(
  gasUnitResults.filter((result) => result.status !== "passed").length,
  0,
  "Tests.gs unit tests must pass",
);

for (const handler of [
  "runMerchantHealthWatch",
  "runSeoHealthAudit",
  "runMeoHealthAudit",
  "runGrowthHealthWatch",
  "runShopifySkuAudit",
]) {
  assert.ok(
    allSource.includes(`withScriptLock_('${handler}'`),
    `${handler} must use LockService wrapper`,
  );
}
assert.ok(
  !allSource.includes("setupKeaGrowthOps();"),
  "health automation must not call setupKeaGrowthOps()",
);
const triggerSource = fs.readFileSync(path.join(root, "Triggers.gs"), "utf8");
assert.equal(
  (triggerSource.match(/ScriptApp\.newTrigger\(/g) || []).length,
  3,
  "health monitoring must not add a duplicate trigger",
);

// Exercise query coverage and lease ownership without any external calls.
let brandLease = "";
const brandContext = vm.createContext({
  Date, JSON, Math, Number, String,
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: () => brandLease,
    setProperty: (_key, value) => { brandLease = value; },
    deleteProperty: () => { brandLease = ""; },
  }) },
  Utilities: { getUuid: () => "test-owner" },
});
new vm.Script(fs.readFileSync(path.join(root, "BrandRankMonitoring.gs"), "utf8"))
  .runInContext(brandContext);
const coveredBrands = vm.runInContext("Object.keys(KEA_BRAND_QUERY_REFERENCES_)", brandContext);
brandContext.dateDaysAgo_ = n => new Date(Date.UTC(2026, 8, 30 - n));
brandContext.dateKey_ = date => date.toISOString().slice(0, 10);
const rankWindows = brandContext.brandRankCurrentWindows_();
assert.equal(rankWindows.length, 6);
assert.equal(rankWindows.find(row => row.key === 'last_7d').start.toISOString().slice(0, 10), '2026-09-21');
assert.equal(rankWindows.find(row => row.key === 'previous_7d').end.toISOString().slice(0, 10), '2026-09-20');
assert.equal(brandContext.brandRankExpiredPrefix_([['2026-05-01'], ['2026-09-01']], new Date('2026-09-30')), 1);
assert.equal(brandContext.brandRankExpiredPrefix_([['invalid'], ['2026-05-01']], new Date('2026-09-30')), 0);
let rankTriggers = ['runBrandNameRankMonitor', 'runBrandNameRankMonitor', 'runDailyGrowthReport']
  .map(handler => ({ getHandlerFunction: () => handler }));
const rankSchedule = {};
brandContext.KEA_DEFAULTS = { TIME_ZONE: 'Asia/Tokyo' };
brandContext.Logger = { log() {} };
brandContext.ScriptApp = {
  getProjectTriggers: () => rankTriggers,
  deleteTrigger: trigger => { rankTriggers = rankTriggers.filter(item => item !== trigger); },
  newTrigger: handler => {
    const builder = { timeBased() { return this; },
      atHour(value) { rankSchedule.hour = value; return this; },
      nearMinute(value) { rankSchedule.minute = value; return this; },
      everyDays(value) { rankSchedule.days = value; return this; },
      inTimezone(value) { rankSchedule.timezone = value; return this; },
      create() { rankTriggers.push({ getHandlerFunction: () => handler }); } };
    return builder;
  },
};
assert.equal(brandContext.ensureBrandNameRankMonitorTrigger().count, 1);
assert.equal(brandContext.ensureBrandNameRankMonitorTrigger().count, 1);
assert.equal(rankTriggers.length, 2, 'keep the other daily report trigger and one rank trigger');
assert.deepEqual(rankSchedule, { hour: 6, minute: 0, days: 1, timezone: 'Asia/Tokyo' });
assert.equal(coveredBrands.length, 16);
for (const vendor of coveredBrands) {
  const entry = { vendor, collectionUrl: "https://example.test/brand",
    collection: { seo: { title: `${vendor}｜実在カテゴリー` } } };
  assert.ok(brandContext.brandRankJapaneseAliases_(brandContext.brandRankAliases_(entry)).length);
  const queries = brandContext.brandRankTargetRows_([entry], []);
  assert.ok(queries.some((row) => row.axis === "ブランド会社名・運営会社名" && row.query));
  assert.ok(queries.filter((row) => row.category).every((row) => row.category === "実在カテゴリー"));
  if (vendor !== 'SUICOKE') assert.ok(queries.some(row => row.category === '実在カテゴリー'));
}
assert.equal(brandContext.brandRankCategories_({ vendor: "SINME" }).length, 0);

// SUICOKE's current verified product is a bag; unrelated title text is not evidence.
const suicokeEntry = { vendor: 'SUICOKE', collectionUrl: 'https://example.test/suicoke',
  collection: { seo: { title: 'SUICOKE（スイコック）｜サンダル・シューズ' } } };
const suicokeProduct = { vendor: 'SUICOKE', handle: 'product-7272', title: 'OUTLANDER',
  productCode: { value: 'OG-BG-005' }, status: 'ACTIVE', publishedAt: '2026-09-20',
  onlineStoreUrl: 'https://store.kea.co.jp/products/product-7272' };
const suicokeInputsBefore = JSON.stringify([suicokeEntry, suicokeProduct]);
const suicokeQueries = brandContext.brandRankTargetRows_([suicokeEntry], [suicokeProduct]);
const suicokeCategoryQueries = suicokeQueries.filter(row => row.axis === 'ブランド名＋カテゴリー');
assert.ok(suicokeCategoryQueries.length > 0);
assert.ok(suicokeCategoryQueries.every(row => row.category === 'バッグ' && row.query.endsWith(' バッグ')));
assert.equal(JSON.stringify([suicokeEntry, suicokeProduct]), suicokeInputsBefore,
  'monitor query generation must not change title, product code or other source data');
for (const products of [[], [{ ...suicokeProduct, handle: 'unknown-handle' }],
  [{ ...suicokeProduct, status: 'DRAFT' }], [{ ...suicokeProduct, publishedAt: null }],
  [{ ...suicokeProduct, onlineStoreUrl: null }]]) {
  const queries = brandContext.brandRankTargetRows_([suicokeEntry], products);
  assert.equal(queries.filter(row => row.axis === 'ブランド名＋カテゴリー').length, 0,
    'unverified or unpublished products must not fall back to bags, sandals or shoes');
  assert.ok(queries.some(row => row.axis === 'ブランド名単体'));
  assert.ok(queries.some(row => row.axis === 'ブランド名＋通販'));
}
brandLease = `${Date.now() + 60000}|existing-owner`;
assert.equal(brandContext.brandRankAcquireLease_(), "");
assert.ok(brandLease.endsWith("|existing-owner"));
brandLease = "";
const brandLeaseToken = brandContext.brandRankAcquireLease_();
assert.ok(brandLeaseToken);
brandContext.brandRankReleaseLease_("other-owner");
assert.ok(brandLease);
brandContext.brandRankReleaseLease_(brandLeaseToken);
assert.equal(brandLease, "");
const brandMetric = brandContext.brandRankMetric_([
  { keys: ["シンメ", "https://example.test/brand"], clicks: 2, impressions: 10, position: 5 },
  { keys: ["シンメ", "https://example.test/product"], clicks: 1, impressions: 5, position: 11 },
], "シンメ", "https://example.test/brand");
assert.equal(brandMetric.impressions, 15);
assert.equal(brandMetric.clicks, 3);
assert.equal(brandMetric.position, 7);

// The existing collection-based KPI keeps unknowns and sparse evidence distinct.
const kpiRows = [
  ['SINME', 305, 8.34], ['Agapantha Jewelry', 2, 9.5], ['BATONER', 1, 1],
  ['Oblada', 31, 14.9], ['Button Works', 23, 11.91], ['SEA', 4, 32.75],
].map(([brand, impressions, position]) => ({
  checkedAt: '2026-10-05T09:00:00+09:00', window: 'last_28d',
  windowStart: '2026-09-05', windowEnd: '2026-10-02', brand,
  brandQuery: brand === 'SINME' ? 'シンメ' : brand,
  collectionImpressions: impressions, collectionPosition: position,
  gscRowsComplete: true, inStockProductCount: 0,
}));
for (const brand of coveredBrands) {
  if (!kpiRows.some(row => row.brand === brand)) {
    kpiRows.push({ ...kpiRows[0], brand, brandQuery: brand,
      collectionImpressions: 0, collectionPosition: 0 });
  }
}
kpiRows.push({ ...kpiRows[0], checkedAt: '2026-09-20T09:00:00+09:00', collectionPosition: 100 });
kpiRows.push({ ...kpiRows[0], window: 'last_3m', collectionPosition: 100 });
kpiRows.push({ ...kpiRows[0], brand: 'Velnica', brandQueryPosition: 1,
  brandQueryImpressions: 100, collectionPosition: 0, collectionImpressions: 0,
  inStockProductCount: '' });
const kpi = brandContext.brandRankKpiFromRows_(kpiRows);
assert.equal(kpi.brandCount, 16);
assert.deepEqual(Array.from(kpi.focusBrands, item => item.brand), ['Oblada', 'SEA', 'BATONER', "LEVI'S", 'SINME']);
assert.deepEqual(Array.from(kpi.brands.slice(0, 5), item => item.brand), Array.from(kpi.focusBrands, item => item.brand));
assert.equal(kpi.top10Count, 3);
assert.equal(kpi.top10Rate, 3 / 16);
assert.equal(kpi.unknownCount, 10);
assert.equal(kpi.nearTop10Count, 2);
assert.equal(kpi.lowerRankCount, 1);
assert.equal(kpi.lowSampleTop10.length, 2);
assert.equal(kpi.brands.find(row => row.brand === 'Velnica').status, 'unknown',
  'a product/old landing page in TOP10 is not brand-collection success');
assert.equal(kpi.brands.find(row => row.brand === 'Velnica').inStockProductCount, null);
assert.equal(kpi.brands.find(row => row.brand === 'SINME').inStockProductCount, 0);
assert.equal(kpi.checkedAt, '2026-10-05T09:00:00+09:00');
const trendBase = { checkedAt: kpi.checkedAt, brand: 'SINME', query: 'シンメ',
  axis: 'ブランド名単体', collectionUrl: kpi.brands.find(row => row.brand === 'SINME').collectionUrl,
  collectionImpressions: 30, collectionClicks: 3, collectionCtr: 0.1,
  collectionPosition: 8, windowStart: '2026-09-21', gscRowsComplete: true };
const trendRows = [
  { ...trendBase, window: 'last_7d' },
  { ...trendBase, window: 'previous_7d', collectionPosition: 12, collectionClicks: 1 },
  { ...trendBase, window: 'previous_7d', query: 'SINME', collectionPosition: 1 },
  { ...trendBase, window: 'previous_7d', collectionUrl: 'https://wrong.test/', collectionPosition: 1 },
  { ...trendBase, window: 'previous_7d', checkedAt: '2026-09-01', collectionPosition: 1 },
];
const trend = brandContext.brandRankFocusTrends_(kpi, trendRows, true).find(row => row.brand === 'SINME');
assert.equal(trend.seven.rankImprovement, 4, 'do not compare another alias, page, or collection run');
assert.equal(trend.seven.status, '改善傾向');
assert.equal(trend.seven.postChange, true);
assert.equal(trend.twentyEight.status, '比較不可');
assert.equal(brandContext.brandRankCompare_({ ...trendBase, collectionImpressions: 1 }, trendBase, true).status, '少量・参考');
assert.equal(brandContext.brandRankCompare_({ ...trendBase, collectionImpressions: 0 }, trendBase, true).status, '片期間未観測');
assert.equal(brandContext.brandRankCompare_(
  { ...trendBase, collectionImpressions: 0 }, { ...trendBase, collectionImpressions: 0 }, true,
).status, '両期間未観測');
assert.equal(brandContext.brandRankCompare_({ ...trendBase, gscRowsComplete: false }, trendBase, true).status, '比較不可');
assert.equal(brandContext.brandRankCompare_(trendBase, trendBase, false).status, '比較不可');
assert.equal(brandContext.brandRankCompare_({ ...trendBase, windowStart: new Date('2026-09-01') }, trendBase, true).postChange, false);
assert.equal(brandContext.brandRankKpiFromRows_([]).available, false);
assert.equal(brandContext.brandRankKpiFromRows_(kpiRows.map(row => ({ ...row,
  gscRowsComplete: false }))).gscRowsComplete, false);
const changedCatalogRows = [
  { ...kpiRows[0], checkedAt: '2026-10-12T09:00:00+09:00' },
  { ...kpiRows[0], checkedAt: '2026-10-12T09:00:00+09:00', brand: 'New Active Brand',
    collectionPosition: 0, collectionImpressions: 0 },
];
const changedCatalogKpi = brandContext.brandRankKpiFromRows_([...kpiRows, ...changedCatalogRows]);
assert.equal(changedCatalogKpi.brandCount, 2, 'retired brands must leave the latest denominator');
assert.equal(changedCatalogKpi.focusBrands.length, 1, 'focus selection must not reintroduce retired brands');
assert.equal(changedCatalogKpi.top10Rate, 1 / 2);
assert.equal(changedCatalogKpi.unknownCount, 1);
assert.equal(changedCatalogKpi.brands.some(row => row.brand === 'BATONER'), false);
assert.equal(changedCatalogKpi.brands.some(row => row.brand === 'New Active Brand'), true,
  'a new active brand must be counted without editing alias references');

// Extending the summary must preserve the previous 24-column observation history.
const summaryHeaders = vm.runInContext('KEA_BRAND_RANK_SUMMARY_HEADERS_', brandContext);
let headerWrites = 0;
const oldHistory = [['historic observation', 'must survive']];
const summaryRange = {
  getValues: () => [[...summaryHeaders.slice(0, 24), '']],
  setValues: rows => { assert.equal(rows[0][24], 'inStockProductCount'); headerWrites++; return summaryRange; },
  setBackground: () => summaryRange, setFontColor: () => summaryRange, setFontWeight: () => summaryRange,
};
brandContext.getDashboardSpreadsheet_ = () => ({ getSheetByName: () => ({
  getRange: () => summaryRange, setFrozenRows() {},
  clearContents: () => { oldHistory.length = 0; },
}) });
brandContext.brandRankEnsureSheet_('BrandSEOBrandRank', summaryHeaders);
assert.equal(headerWrites, 1);
assert.equal(oldHistory.length, 1);

// The monitor adds stock counts from its existing catalog; no new fetch is needed.
let rankFetches = 0;
let appendedSummary = [];
brandContext.keaConfig_ = () => ({});
brandContext.collectShopifyCatalog_ = () => ({ available: true, products: [
  { vendor: 'SINME', status: 'ACTIVE', publishedAt: 'date', onlineStoreUrl: 'url', totalInventory: 2 },
  { vendor: 'SINME', status: 'ACTIVE', publishedAt: 'date', onlineStoreUrl: 'url', totalInventory: 0 },
  { vendor: 'SINME', status: 'ACTIVE', publishedAt: null, onlineStoreUrl: 'url', totalInventory: 9 },
] });
brandContext.brandSeoActiveVendorRows_ = () => [{ vendor: 'SINME', productCount: 2 },
  { vendor: 'BATONER', productCount: 1 }];
brandContext.collectBrandSeoCollections_ = () => [];
brandContext.brandSeoConfiguration_ = row => ({ ...row, collectionUrl: `https://example.test/${row.vendor}` });
brandContext.brandRankProductCatalog_ = () => [];
brandContext.brandRankCurrentWindows_ = () => ['last_7d', 'previous_7d', 'last_28d', 'previous_28d', 'last_3m', 'previous_3m']
  .map(key => ({ key, start: new Date('2026-09-05'), end: new Date('2026-10-02') }));
brandContext.brandRankSearchConsoleQueryPageRows_ = () => { rankFetches++; return { rows: [], complete: true }; };
brandContext.isoTimestamp_ = date => date.toISOString();
brandContext.dateKey_ = date => date.toISOString().slice(0, 10);
brandContext.brandRankOldEcChecks_ = () => [];
brandContext.brandRankEntryTech_ = () => [];
brandContext.brandRankReplaceRows_ = () => {};
brandContext.brandRankAppendRows_ = (_name, headers, rows) => {
  assert.equal(headers.length, 25);
  appendedSummary = rows;
};
brandContext.brandRankRun_(true);
assert.equal(rankFetches, 6);
assert.equal(appendedSummary.length, 12);
assert.ok(appendedSummary.every(row => row.length === 25 && !row[23].includes('9/20')));
assert.ok(appendedSummary.filter(row => row[4] === 'SINME').every(row => row[24] === 1));
assert.ok(appendedSummary.filter(row => row[4] === 'BATONER').every(row => row[24] === 0));
brandContext.rowObject_ = context.rowObject_;
brandContext.getDashboardSpreadsheet_ = () => ({ getSheetByName: () => ({
  getDataRange: () => ({ getValues: () => [summaryHeaders, ...appendedSummary] }),
}) });
assert.equal(brandContext.readBrandRankKpi_().brands.find(row => row.brand === 'SINME').inStockProductCount, 1);
assert.equal(rankFetches, 6, 'reading a daily/dashboard KPI must not rerun GSC');
brandContext.readBrandRankKpi_ = () => kpi;
kpi.focusTrends = [trend];
const kpiReport = brandContext.buildBrandRankKpiSummary_();
assert.match(kpiReport, /3\/16ブランド（18.8%/);
assert.match(kpiReport, /unknown: 10/);
assert.match(kpiReport, /重点ブランド（優先対応）: Oblada:.*SEA:.*BATONER:.*LEVI'S: 未観測.*SINME:/);
assert.match(kpiReport, /2026-10-05/);
assert.doesNotMatch(kpiReport, /9\/20.*基準値/);
assert.match(kpiReport, /1〜2表示は暫定/);
assert.match(kpiReport, /対象ブランドコレクション/);
assert.match(kpiReport, /7日: 順位 12.00→8.00/);
brandContext.readBrandRankKpi_ = () => ({ available: false, reason: 'read failed' });
assert.match(brandContext.buildBrandRankKpiSummary_(), /未取得.*read failed/);

// Render the same KPI ahead of site-wide SEO values and retain escaped text.
const elements = { content: {}, status: {}, sheetLink: {} };
const renderContext = vm.createContext({
  Intl, console, document: { getElementById: id => elements[id] },
  google: { script: { run: { withSuccessHandler() { return this; },
    withFailureHandler() { return this; }, getDashboardData() {} } } },
});
new vm.Script(dashboardScript[1]).runInContext(renderContext);
renderContext.render({ health: { brandRank: kpi } });
assert.match(elements.content.innerHTML, /GSC無観測・unknown/);
assert.match(elements.content.innerHTML, /18.8%/);
assert.match(elements.content.innerHTML, /12.00→8.00/);
assert.ok(elements.content.innerHTML.indexOf('主要KPI：') < elements.content.innerHTML.indexOf('サイト全体・技術状態'));
renderContext.render({ health: { brandRank: { ...kpi, definition: '<script>invalid</script>' } } });
assert.ok(!elements.content.innerHTML.includes('<script>invalid</script>'));
renderContext.render({ health: { brandRank: { available: false } } });
assert.match(elements.content.innerHTML, /ブランド名単体TOP10率：未取得/);

console.log(
  JSON.stringify(
    {
      status: "passed",
      gasFiles: gasFiles.length,
      checks: 152,
      gasUnitTests: gasUnitResults.length,
      brandQueryCoverage: coveredBrands.length,
      brandNameKpi: { top10: kpi.top10Count, unknown: kpi.unknownCount,
        provisionalTop10: kpi.lowSampleTop10.length, historyPreserved: true },
    },
    null,
    2,
  ),
);
