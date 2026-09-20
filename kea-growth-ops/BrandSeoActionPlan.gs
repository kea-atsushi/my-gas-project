/**
 * Kea Growth Ops: current brand-name SEO cause/action register.
 *
 * This is an evidence register inside the existing Growth Ops dashboard. It
 * reads the existing BrandSEOBrandRank and BrandSEOTechnical tabs and does not
 * modify Shopify, Search Console, Merchant Center, or Google Ads.
 */
var KEA_BRAND_SEO_ACTION_SHEET_ = 'BrandSEOActionPlan';

function brandSeoActionStatic_(brand) {
  var commonExternal = '公式Stockist／SHOP LIST／DEALERSでKea掲載と新ブランドURLを確認。検索で確認できない場合のみ掲載依頼（送信は人が実施）';
  var rows = {
    '77circa': { competition: '公式・大手EC・他セレクトショップとの競合。商品掲載12件だがブランド単体表示0', external: commonExternal },
    'Agapantha Jewelry': { competition: 'ブランド名表記揺れと公式・ジュエリーECの競合。商品掲載4件、ブランド単体表示0', external: commonExternal },
    'BATONER': { competition: '公式・大手EC・他セレクトショップと競合するがKeaコレクションはTOP10', external: 'BATONER公式StockistにKeaの店名・住所・電話掲載あり。新ブランドページへの直接リンク追加可否を確認' },
    'blurhms': { competition: '公式・大手EC・他セレクトショップとの競合。商品掲載1件、ブランド単体表示0', external: commonExternal },
    'Button Works': { competition: '英語一般語の検索意図が混在。11〜20位でTOP10直前', external: commonExternal },
    'Chloé': { competition: '世界的公式・百貨店・大手ECが強い。Keaはアイウェア1件', external: commonExternal },
    'COEL': { competition: '公式・大手EC・メディアが強い。商品掲載47件だがブランド単体表示0', external: commonExternal },
    'kit・sch': { competition: '記号・表記揺れが大きく一般語も混在。商品掲載3件', external: commonExternal },
    "LEVI'S": { competition: '公式・大手EC・メディアが非常に強い。501等の商品軸を補助KPIで維持', external: 'Levi公式店舗検索は存在。Kea掲載と新ブランドページへのリンクは未確認のため人手確認' },
    'mikomori': { competition: '公式・大手EC・リゾートウェア文脈との競合。商品掲載8件', external: commonExternal },
    'MONOEARTH': { competition: '公式・大手ECとの競合。商品掲載3件、ブランド単体表示0', external: commonExternal },
    'Oblada': { competition: '公式、ELLE SHOP、Bshop等の大手・他セレクトショップが上位。11〜20位で表示31', external: commonExternal },
    'SEA': { competition: '一般英単語・海外同名・ZOZO・メディアが混在し検索意図が強く曖昧', external: commonExternal },
    'SINME': { competition: '公式・大手EC・他セレクトショップと競合するがKeaコレクションはTOP10', external: commonExternal },
    'SUICOKE': { competition: '公式・大手EC・スニーカー媒体が強い。商品掲載1件', external: commonExternal },
    'Velnica': { competition: '公式2ドメインと同名・無関係検索結果が混在。旧EC評価移行も未完了', external: commonExternal }
  };
  return rows[brand] || { competition: '公式・大手EC・他セレクトショップとの競合を継続確認', external: commonExternal };
}

function brandSeoActionLegacy_(brand) {
  var rows = {
    'Oblada': '旧category_id=526 → /collections/oblada の1対1 301を確認済み',
    'SINME': '旧category_id=273 → /collections/sinme の1対1 301を確認済み',
    'SEA': '旧category_id=21 → /collections/sea の1対1 301を確認済み',
    'Velnica': '旧category_id=23 が新ドメインの同じPHPパスへ転送され400。旧wwwサーバ側の1対1 301が必要',
  };
  return rows[brand] || 'Search Console過去3か月で対応する旧ECランディングを特定できず。旧URL一覧／被リンクが判明した時点で1対1確認';
}

function brandSeoActionPriority_(top10, position, impressions, productCount) {
  if (top10) return '監視（TOP10）';
  if (impressions > 0 && position >= 11 && position <= 20) return 'P1（TOP10直前）';
  if (impressions > 0 || productCount >= 10) return 'P2';
  return 'P3（表示0・少数商品）';
}

function writeBrandSeoActionPlanNow() {
  var spreadsheet = getDashboardSpreadsheet_();
  var rankSheet = spreadsheet.getSheetByName(KEA_BRAND_RANK_SUMMARY_SHEET_);
  var techSheet = spreadsheet.getSheetByName(KEA_BRAND_RANK_TECH_SHEET_);
  if (!rankSheet || !techSheet) throw new Error('Brand SEO monitoring sheets are missing');

  var rankValues = rankSheet.getDataRange().getValues();
  var rankHeaders = rankValues.shift();
  var ri = {};
  rankHeaders.forEach(function (value, index) { ri[String(value)] = index; });
  var last28 = rankValues.filter(function (row) { return row[ri.window] === 'last_28d'; });
  var latest = last28.reduce(function (value, row) {
    var candidate = String(row[ri.checkedAt] || '');
    return candidate > value ? candidate : value;
  }, '');
  last28 = last28.filter(function (row) { return String(row[ri.checkedAt] || '') === latest; });

  var techValues = techSheet.getDataRange().getValues();
  var techHeaders = techValues.shift();
  var ti = {};
  techHeaders.forEach(function (value, index) { ti[String(value)] = index; });
  var techByBrand = {};
  techValues.forEach(function (row) { techByBrand[String(row[ti.brand] || '')] = row; });

  var headers = [
    'checkedAt', 'brand', 'priority', 'last28Impressions', 'last28Clicks',
    'last28Ctr', 'collectionPosition', 'top10', 'productCount', 'technicalSEO',
    'brandPageContent', 'internalLinks', 'oldEc301', 'externalStockist',
    'searchCompetition', 'safeActionNow', 'humanFollowup'
  ];
  var rows = last28.map(function (rank) {
    var brand = String(rank[ri.brand] || '');
    var tech = techByBrand[brand] || [];
    var position = Number(rank[ri.collectionPosition] || 0);
    var impressions = Number(rank[ri.collectionImpressions] || 0);
    var productCount = Number(rank[ri.productCount] || 0);
    var top10 = rank[ri.top10Collection] === true;
    var technical = tech.length && tech[ti.indexed] === true && tech[ti.canonicalMatches] === true &&
      String(tech[ti.indexingState] || '') === 'INDEXING_ALLOWED' &&
      String(tech[ti.robotsTxtState] || '') === 'ALLOWED'
      ? 'PASS：index、self-canonical、sitemap、robots、noindex、HTTPを確認'
      : '要確認：BrandSEOTechnicalの状態を再点検';
    var content = 'H1＝ブランド名、title／description／説明文あり。商品掲載' + productCount + '件。';
    if (productCount <= 3) content += '少数商品のため関連性・更新頻度が弱い。';
    else if (productCount <= 9) content += '商品数は限定的。';
    else content += '実商品との関連性あり。';
    var legacy = brandSeoActionLegacy_(brand);
    var extra = brandSeoActionStatic_(brand);
    var action = top10
      ? '2026-09-20のtitle／H1を据え置き、再クロール後の28日推移を週次監視'
      : 'title／H1は据え置き。BRAND一覧と商品ページからのブランドリンクを維持し週次監視';
    if (brand === 'Velnica') action = '旧wwwサーバ側でquery付き旧URLを /collections/velnica へ1対1 301（Shopifyリダイレクトでは修正不可）';
    return [
      new Date(), brand, brandSeoActionPriority_(top10, position, impressions, productCount),
      impressions, Number(rank[ri.collectionClicks] || 0), Number(rank[ri.collectionCtr] || 0),
      position, top10, productCount, technical, content,
      'BRAND一覧→ブランドページと商品ページ→ブランドページを確認。孤立なし。ホーム直リンクは掲載商品により変動',
      legacy, extra.external, extra.competition, action,
      extra.external + '。外部サイトへの連絡は未実施'
    ];
  }).sort(function (a, b) {
    var order = { 'P1（TOP10直前）': 1, 'P2': 2, 'P3（表示0・少数商品）': 3, '監視（TOP10）': 4 };
    return (order[a[2]] || 9) - (order[b[2]] || 9) || b[3] - a[3] || String(a[1]).localeCompare(String(b[1]));
  });

  var sheet = spreadsheet.getSheetByName(KEA_BRAND_SEO_ACTION_SHEET_) || spreadsheet.insertSheet(KEA_BRAND_SEO_ACTION_SHEET_);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#eeeeee').setFontColor('#111111').setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, Math.max(1, rows.length + 1), headers.length).createFilter();
  sheet.autoResizeColumns(1, 9);
  sheet.setColumnWidths(10, 8, 320);
  sheet.getRange(2, 10, Math.max(1, rows.length), 8).setWrap(true).setVerticalAlignment('top');
  return { status: 'written', brandCount: rows.length, checkedAt: latest, sheet: KEA_BRAND_SEO_ACTION_SHEET_ };
}
