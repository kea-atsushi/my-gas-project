import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = ['SaleBulkSupport.gs', 'SaleBulkShopify.gs', 'SaleBulk.gs'];
const context = vm.createContext({
  console,
  Number,
  Math,
  String,
  Array,
  Object,
  Error,
  RegExp,
  Date,
});
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(source, { filename: file }).runInContext(context);
}

const html = fs.readFileSync(path.join(root, 'SaleBulk.html'), 'utf8');
assert.ok(html.includes('SALE一括設定'));
assert.ok(html.includes('google.script.run'));
assert.ok(html.includes('@media(max-width:520px)'));
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline, 'SALE画面のscriptがありません');
new vm.Script(inline[1], { filename: 'SaleBulk.inline.js' });

assert.equal(context.salePriceFromPercent_(30000, 30), 21000);
assert.equal(context.salePriceFromPercent_(999, 30), 699);
assert.throws(() => context.salePriceFromPercent_(30000, 0));

const product = {
  id: 'gid://shopify/Product/1',
  title: 'TEST',
  productCode: { value: 'A001' },
  variants: {
    nodes: [{
      id: 'gid://shopify/ProductVariant/1',
      title: 'M / BLACK',
      sku: 'A001-M-BLACK',
      price: '21000',
      compareAtPrice: '30000',
    }],
  },
};
const changed = context.buildSaleBulkPlan_([product], 'APPLY', 40);
assert.equal(changed.products[0].variants[0].nextPrice, 18000);
assert.equal(changed.products[0].variants[0].nextCompareAtPrice, 30000);
const ended = context.buildSaleBulkPlan_([product], 'END', null);
assert.equal(ended.products[0].variants[0].nextPrice, 30000);
assert.equal(ended.products[0].variants[0].nextCompareAtPrice, null);

console.log(JSON.stringify({ status: 'passed', checks: 13 }, null, 2));
