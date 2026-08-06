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
  "ShopifySkuAudit",
  "runShopifySkuAudit",
  "custom\", key: \"product_code",
  "selectedOptions",
]) {
  assert.ok(allSource.includes(required), `missing required behavior: ${required}`);
}
assert.ok(
  !/OPENAI_API_KEY\s*[:=]\s*['"][^'"]+['"]/.test(allSource),
  "OpenAI key must not be committed",
);
assert.ok(
  !/SHOPIFY_ADMIN_ACCESS_TOKEN\s*[:=]\s*['"][^'"]+['"]/.test(allSource),
  "Shopify token must not be committed",
);
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
    );
    const chart = { id: `${name}-chart` };
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
            );
          },
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
try {
  const successWorkbook = createSkuPublishWorkbook_(false);
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
  );
  assert.equal(skippedHealth.status, "skipped");
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
    pending: 0,
    disapproved: 7,
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
  context.seoCtrCandidate_({ impressions: 30, ctr: 0.019 }),
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
  duplicateSkuCount: 1,
  duplicateProductCodeCount: 1,
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

console.log(
  JSON.stringify(
    {
      status: "passed",
      gasFiles: gasFiles.length,
      checks: 141,
      gasUnitTests: gasUnitResults.length,
    },
    null,
    2,
  ),
);
