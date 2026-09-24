/**
 * Weekly decisions in the existing action register. No Shopify writes or mail.
 * Keep the original columns and historic rows; append one complete 16-brand week.
 */
var KEA_BRAND_SEO_ACTION_SHEET_ = 'BrandSEOActionPlan';
var KEA_BRAND_SEO_ACTION_HEADERS_ = [
  'checkedAt', 'brand', 'priority', 'last28Impressions', 'last28Clicks',
  'last28Ctr', 'collectionPosition', 'top10', 'productCount', 'technicalSEO',
  'brandPageContent', 'internalLinks', 'oldEc301', 'externalStockist',
  'searchCompetition', 'safeActionNow', 'humanFollowup',
  'decisionWeek', 'query', 'weekStart', 'weekEnd', 'weekPosition',
  'weekImpressions', 'weekClicks', 'weekCtr', 'weekTop10', 'rankImprovement',
  'focusState', 'focusStartedAt', 'changesThisWeek', 'nextAction', 'reviewUntil'
];

function brandSeoActionPriority_(top10, position, impressions) {
  if (top10) return '維持（TOP10）';
  if (impressions > 0 && position > 10 && position <= 20) return 'A（11〜20位）';
  if (impressions > 0 && position > 20 && position <= 40) return 'B（21〜40位）';
  return 'C（40位超・未観測）';
}

function brandSeoPlanRows_(sheet) {
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift() || [];
  return values.map(function (row) { return rowObject_(headers, row); });
}

function brandSeoDecisionWeek_(now) {
  var date = new Date(dateKey_(now) + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function readBrandSeoWeeklyPlan_() {
  var rows = brandSeoPlanRows_(getDashboardSpreadsheet_().getSheetByName(KEA_BRAND_SEO_ACTION_SHEET_))
    .filter(function (row) { return row.decisionWeek; });
  var latest = rows.reduce(function (value, row) {
    return Math.max(value, new Date(row.checkedAt).getTime() || 0);
  }, 0);
  return rows.filter(function (row) { return new Date(row.checkedAt).getTime() === latest; });
}

function buildBrandSeoWeeklyPlan_(rankRows, queryRows, techRows, history, now) {
  var kpi = brandRankKpiFromRows_(rankRows);
  var stamp = new Date(kpi.checkedAt).getTime();
  if (!kpi.available || !kpi.gscRowsComplete || kpi.brandCount !== 16 ||
      now.getTime() - stamp > 48 * 3600000 || stamp > now.getTime()) {
    throw new Error('Fresh complete 16-brand observations required; previous decisions preserved');
  }
  var current = rankRows.filter(function (row) {
    return row.window === 'last_28d' && new Date(row.checkedAt).getTime() === stamp;
  });
  var queryCurrent = queryRows.filter(function (row) {
    return row.axis === 'ブランド名単体' && new Date(row.checkedAt).getTime() === stamp;
  });
  var week = brandSeoDecisionWeek_(now);
  var day = dateKey_(now);
  var previous = {};
  history.filter(function (row) { return row.decisionWeek; }).forEach(function (row) {
    if (!previous[row.brand] || new Date(row.checkedAt) > new Date(previous[row.brand].checkedAt)) previous[row.brand] = row;
  });
  var items = current.map(function (rank) {
    var brand = rank.brand, prior = previous[brand] || {};
    var impressions = Number(rank.collectionImpressions || 0);
    var position = impressions > 0 && Number(rank.collectionPosition) > 0 ? Number(rank.collectionPosition) : null;
    var top10 = position !== null && position <= 10;
    var query = prior.focusState === '集中' ? prior.query : rank.brandQuery;
    var matching = queryCurrent.filter(function (row) {
      return row.brand === brand && row.collectionUrl === rank.collectionUrl &&
        brandRankNormalizeQuery_(row.query) === brandRankNormalizeQuery_(query);
    });
    var a = matching.filter(function (row) { return row.window === 'last_7d'; })[0];
    var b = matching.filter(function (row) { return row.window === 'previous_7d'; })[0];
    if (!a || !b || !(a.gscRowsComplete === true || a.gscRowsComplete === 'TRUE') ||
        !(b.gscRowsComplete === true || b.gscRowsComplete === 'TRUE')) {
      throw new Error('Complete weekly query rows required for ' + brand);
    }
    var comparison = brandRankCompare_(a, b, true);
    var tech = techRows.filter(function (row) { return row.brand === brand; })[0] || {};
    var techFresh = now.getTime() - new Date(tech.checkedAt).getTime() <= 48 * 3600000;
    var techOk = techFresh && tech.indexed === true && tech.canonicalMatches === true &&
      tech.indexingState === 'INDEXING_ALLOWED' && tech.robotsTxtState === 'ALLOWED' &&
      Number(tech.finalHttpStatus || tech.httpStatus) === 200;
    var start = prior.focusState === '集中' ? String(prior.focusStartedAt || day) : day;
    var age = Math.floor((now.getTime() - new Date(start + 'T00:00:00+09:00').getTime()) / 86400000);
    var baseline = history.filter(function (row) {
      return row.brand === brand && row.focusState === '集中' &&
        String(row.focusStartedAt) === start && row.query === query;
    }).sort(function (x, y) { return new Date(x.checkedAt) - new Date(y.checkedAt); })[0];
    var improved = baseline && Number(baseline.weekImpressions) >= 10 && comparison.current.impressions >= 10 &&
      baseline.weekPosition !== '' && comparison.current.position !== null &&
      Number(baseline.weekPosition) - comparison.current.position >= 1;
    var reviewUntil = String(prior.reviewUntil || '');
    var reassess = !top10 && prior.focusState === '集中' && age >= 21 && !improved;
    if (reassess) reviewUntil = dateKey_(new Date(now.getTime() + 14 * 86400000));
    var cooling = !top10 && reviewUntil > day;
    return { brand: brand, rank: rank, prior: prior, query: query, a: a, b: b, comparison: comparison,
      position: position, top10: top10, techOk: techOk, age: age, start: start,
      priority: brandSeoActionPriority_(top10, position, impressions),
      cooling: cooling, reviewUntil: cooling ? reviewUntil : '' };
  });
  var candidates = items.filter(function (item) { return !item.top10 && !item.cooling; });
  candidates.sort(function (a, b) {
    var group = function (item) {
      if (!item.techOk) return 0;
      return item.priority[0] === 'A' ? 1 : item.priority[0] === 'B' ? 2 : 3;
    };
    var highCompetition = function (item) { return ['LEVI\'S', 'Chloé', 'SUICOKE'].indexOf(item.brand) >= 0 ? 1 : 0; };
    return group(a) - group(b) || highCompetition(a) - highCompetition(b) ||
      (group(a) < 3 ? (a.position || 999) - (b.position || 999) :
        Number(b.rank.productCount || 0) - Number(a.rank.productCount || 0)) ||
      String(a.brand).localeCompare(String(b.brand));
  });
  var focus = candidates.slice(0, 5).map(function (item) { return item.brand; });
  return items.map(function (item) {
    var rank = item.rank, prior = item.prior, cmp = item.comparison;
    var state = item.top10 ? '維持' : item.cooling ? '再評価' : focus.indexOf(item.brand) >= 0 ? '集中' : '待機';
    var next = state === '維持' ? '成功箇所を維持。週次でTOP10と表示数を確認' :
      state === '再評価' ? '21日以上改善を確認できず。同じ修正を停止し、競合・検索意図・本文・リンク・canonical・index・外部評価を再評価。観測不足は効果なしと断定しない' :
      state === '集中' && !item.techOk ? '技術状態を最優先で確認し、対象URLの不具合だけ修正' :
      state === '集中' && item.age >= 14 ? '2週間経過。競合・検索意図・再クロールを再評価し、同じ修正を繰り返さない' :
      state === '集中' ? '再クロール後の同一語・同一URLの週次推移を確認。未観測は需要ゼロと判断しない' :
      '集中枠が空いた時にA→B→Cの順で再選定';
    var initial = day === '2026-09-24' && KEA_BRAND_RANK_FOCUS_BRANDS_.indexOf(item.brand) >= 0;
    var changed = initial ? 'HOME本文からブランドへリンク追加' +
      (['Button Works', 'COEL', '77circa'].indexOf(item.brand) >= 0 ? '。title・H1・descriptionに公式日本語名を補完' : '') :
      '今週の新たなSEO変更は未記録（自動判定のみ）';
    return [
      now, item.brand, item.priority, Number(rank.collectionImpressions || 0),
      Number(rank.collectionClicks || 0), Number(rank.collectionCtr || 0), item.position === null ? '' : item.position,
      item.top10, Number(rank.productCount || 0),
      item.techOk ? 'PASS：GSC index・canonical・robots・HTTP（保存済み最新値）' : '要確認：BrandSEOTechnical参照',
      prior.brandPageContent || '2026-09-24確認：既存紹介本文を保持。商品の変更なし',
      initial ? 'HOME→ブランドを追加。BRAND一覧・CATEGORY・商品詳細→ブランドを維持' : prior.internalLinks || '既存導線を維持',
      prior.oldEc301 || 'BrandSEOTechnicalの旧URL診断を参照',
      prior.externalStockist || '2026-09-24調査記録参照。外部連絡は未実施',
      prior.searchCompetition || (item.priority[0] === 'C' ? '単体検索は未観測または低順位。需要・難易度は未確定' : '観測順位に基づき優先'),
      next, '外部サイトへの連絡は自動送信しない',
      week, item.query, item.a ? item.a.windowStart : '', item.a ? item.a.windowEnd : '',
      cmp.current.position === null ? '' : cmp.current.position, cmp.current.impressions,
      cmp.current.clicks, cmp.current.ctr, cmp.current.position === null ? '未観測' : cmp.current.position <= 10,
      cmp.status === '比較不可' || cmp.rankImprovement === null ? '' : cmp.rankImprovement,
      state, state === '集中' ? item.start : '', changed, next, item.reviewUntil
    ];
  });
}

function writeBrandSeoActionPlanNow() {
  return withScriptLock_('writeBrandSeoActionPlanNow', function () {
    var spreadsheet = getDashboardSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(KEA_BRAND_SEO_ACTION_SHEET_);
    if (!sheet) throw new Error('Existing BrandSEOActionPlan is required');
    var history = brandSeoPlanRows_(sheet);
    var now = new Date(), week = brandSeoDecisionWeek_(now);
    var written = history.filter(function (row) { return String(row.decisionWeek) === week; });
    if (written.length === 16 && new Set(written.map(function (row) { return row.brand; })).size === 16) {
      return { status: 'already_written', decisionWeek: week, brandCount: 16 };
    }
    if (written.length) throw new Error('Partial weekly plan exists; do not append duplicate decisions');
    var headers = KEA_BRAND_SEO_ACTION_HEADERS_;
    var existing = sheet.getRange(1, 1, 1, 17).getValues()[0];
    if (existing.join('|') !== headers.slice(0, 17).join('|')) throw new Error('Action register header conflict');
    var rows = buildBrandSeoWeeklyPlan_(
      brandSeoPlanRows_(spreadsheet.getSheetByName(KEA_BRAND_RANK_SUMMARY_SHEET_)),
      brandSeoPlanRows_(spreadsheet.getSheetByName(KEA_BRAND_RANK_QUERY_SHEET_)),
      brandSeoPlanRows_(spreadsheet.getSheetByName(KEA_BRAND_RANK_TECH_SHEET_)), history, now);
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    var start = sheet.getLastRow() + 1;
    if (sheet.getMaxRows() < start + rows.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), start + rows.length - 1 - sheet.getMaxRows());
    [18, 29, 32].forEach(function (column) { sheet.getRange(start, column, rows.length, 1).setNumberFormat('@'); });
    sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
    SpreadsheetApp.flush();
    var readback = sheet.getRange(start, 1, rows.length, headers.length).getValues();
    if (readback.some(function (row, index) { return row[1] !== rows[index][1] || row[27] !== rows[index][27]; })) throw new Error('Weekly plan readback mismatch');
    var filter = sheet.getFilter();
    if (filter) filter.remove();
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
    sheet.setFrozenRows(1);
    sheet.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    sheet.getRange(start, 10, rows.length, headers.length - 9).setWrap(true).setVerticalAlignment('top');
    sheet.setColumnWidths(18, 12, 120);
    sheet.setColumnWidths(30, 2, 340);
    var result = { status: 'written', decisionWeek: week, brandCount: rows.length,
      focus: rows.filter(function (row) { return row[27] === '集中'; }).map(function (row) { return row[1]; }),
      top10Count: rows.filter(function (row) { return row[7]; }).length };
    Logger.log(JSON.stringify(result));
    return result;
  });
}
