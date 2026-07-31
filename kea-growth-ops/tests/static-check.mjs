import assert from "node:assert/strict";
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
    formatDate(date) {
      return new Date(date).toISOString().replace(".000Z", "+09:00");
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

const dashboard = fs.readFileSync(path.join(root, "Dashboard.html"), "utf8");
assert.ok(dashboard.includes("@media (max-width: 430px)"));
assert.ok(dashboard.includes("google.script.run"));
assert.ok(dashboard.includes("貢献利益"));
assert.ok(dashboard.includes("人気ブランド"));
assert.ok(dashboard.includes("brandRows"));

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

console.log(
  JSON.stringify(
    {
      status: "passed",
      gasFiles: gasFiles.length,
      checks: 34,
    },
    null,
    2,
  ),
);
