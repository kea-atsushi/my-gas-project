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
assert.ok(dashboard.includes("Merchant"));
assert.ok(dashboard.includes("SEO"));
assert.ok(dashboard.includes("MEO"));
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
      checks: 61,
      gasUnitTests: gasUnitResults.length,
    },
    null,
    2,
  ),
);
