const KEA_GBP_EXPECTED = Object.freeze({
  name: 'Kea.',
  address: '愛知県名古屋市中区大須3丁目2-1 OSビル1F',
  phone: '052-242-0700',
  website: 'https://store.kea.co.jp/',
  hours: {
    SUNDAY: '11:00-20:00',
    MONDAY: '11:00-20:00',
    TUESDAY: 'closed',
    WEDNESDAY: 'closed',
    THURSDAY: '11:00-20:00',
    FRIDAY: '11:00-20:00',
    SATURDAY: '11:00-20:00',
  },
});

const KEA_GBP_PERFORMANCE_METRICS = Object.freeze([
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
]);

function gbpAccountName_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.indexOf('accounts/') === 0 ? text : 'accounts/' + text;
}

function gbpLocationName_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.indexOf('locations/') === 0) return text;
  const match = text.match(/locations\/([^/]+)$/);
  return match ? 'locations/' + match[1] : 'locations/' + text;
}

function gbpLocationId_(locationName) {
  const match = String(locationName || '').match(/locations\/([^/]+)$/);
  return match ? match[1] : '';
}

function listGbpAccounts_() {
  const accounts = [];
  let pageToken = '';
  do {
    let url =
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const response = googleJson_(url, { method: 'get' }, 'GBP accounts.list');
    (response.accounts || []).forEach(function (account) {
      accounts.push(account);
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return accounts;
}

function gbpLocationReadMask_() {
  return [
    'name',
    'title',
    'storefrontAddress',
    'phoneNumbers',
    'websiteUri',
    'regularHours',
    'specialHours',
    'categories',
    'metadata',
  ].join(',');
}

function listGbpLocations_(accountName) {
  const locations = [];
  let pageToken = '';
  do {
    let url =
      'https://mybusinessbusinessinformation.googleapis.com/v1/' +
      accountName + '/locations?readMask=' +
      encodeURIComponent(gbpLocationReadMask_()) + '&pageSize=100';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const response = googleJson_(url, { method: 'get' }, 'GBP locations.list');
    (response.locations || []).forEach(function (location) {
      locations.push(location);
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return locations;
}

function discoverGbpCandidates_() {
  const accounts = listGbpAccounts_();
  const candidates = [];
  const errors = [];
  accounts.slice(0, 10).forEach(function (account) {
    try {
      listGbpLocations_(account.name).forEach(function (location) {
        candidates.push({
          accountId: account.name,
          accountName: account.accountName || '',
          locationId: location.name,
          title: location.title || '',
          address: formatGbpAddress_(location.storefrontAddress),
          phone: gbpPrimaryPhone_(location),
        });
      });
    } catch (error) {
      errors.push(
        account.name + ': ' + String(error && error.message || error),
      );
    }
  });
  return { accounts: accounts, candidates: candidates, errors: errors };
}

function getGbpLocation_(locationName) {
  return googleJson_(
    'https://mybusinessbusinessinformation.googleapis.com/v1/' +
      locationName + '?readMask=' + encodeURIComponent(gbpLocationReadMask_()),
    { method: 'get' },
    'GBP locations.get',
  );
}

function getGbpAttributes_(locationName) {
  return googleJson_(
    'https://mybusinessbusinessinformation.googleapis.com/v1/' +
      locationName + '/attributes',
    { method: 'get' },
    'GBP attributes.get',
  );
}

function getGbpVoiceState_(locationName) {
  return googleJson_(
    'https://mybusinessverifications.googleapis.com/v1/' +
      locationName + '/VoiceOfMerchantState',
    { method: 'get' },
    'GBP VoiceOfMerchant',
  );
}

function collectGbpReviews_(accountName, locationName) {
  if (!accountName) throw new Error('GBP_ACCOUNT_ID未設定');
  const parent = accountName + '/' + locationName;
  const reviews = [];
  let pageToken = '';
  let totalReviewCount = null;
  let averageRating = null;
  do {
    let url =
      'https://mybusiness.googleapis.com/v4/' + parent +
      '/reviews?pageSize=50&orderBy=updateTime%20desc';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const response = googleJson_(url, { method: 'get' }, 'GBP reviews.list');
    (response.reviews || []).forEach(function (review) {
      reviews.push(review);
    });
    if (response.totalReviewCount !== undefined) {
      totalReviewCount = Number(response.totalReviewCount || 0);
    }
    if (response.averageRating !== undefined) {
      averageRating = Number(response.averageRating || 0);
    }
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return {
    reviews: reviews,
    totalReviewCount: totalReviewCount,
    averageRating: averageRating,
  };
}

function gbpPerformanceSummary_(response) {
  const totals = {};
  KEA_GBP_PERFORMANCE_METRICS.forEach(function (metric) {
    totals[metric] = 0;
  });
  ((response && response.multiDailyMetricTimeSeries) || []).forEach(
    function (group) {
      (group.dailyMetricTimeSeries || []).forEach(function (series) {
        const metric = String(series.dailyMetric || '');
        if (!Object.prototype.hasOwnProperty.call(totals, metric)) return;
        totals[metric] += ((series.timeSeries &&
          series.timeSeries.datedValues) || []).reduce(
          function (sum, item) {
            return sum + Number(item.value || 0);
          },
          0,
        );
      });
    },
  );
  return {
    businessImpressions:
      totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS +
      totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH +
      totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS +
      totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH,
    websiteClicks: totals.WEBSITE_CLICKS,
    callClicks: totals.CALL_CLICKS,
    directionRequests: totals.BUSINESS_DIRECTION_REQUESTS,
  };
}

function collectGbpPerformance_(locationName) {
  const endDate = dateDaysAgo_(1);
  const startDate = dateDaysAgo_(7);
  const startParts = dateKey_(startDate).split('-');
  const endParts = dateKey_(endDate).split('-');
  const parameters = KEA_GBP_PERFORMANCE_METRICS.map(function (metric) {
    return 'dailyMetrics=' + encodeURIComponent(metric);
  });
  [
    ['dailyRange.start_date.year', startParts[0]],
    ['dailyRange.start_date.month', startParts[1]],
    ['dailyRange.start_date.day', startParts[2]],
    ['dailyRange.end_date.year', endParts[0]],
    ['dailyRange.end_date.month', endParts[1]],
    ['dailyRange.end_date.day', endParts[2]],
  ].forEach(function (item) {
    parameters.push(
      encodeURIComponent(item[0]) + '=' + encodeURIComponent(item[1]),
    );
  });
  const response = googleJson_(
    'https://businessprofileperformance.googleapis.com/v1/' +
      locationName + ':fetchMultiDailyMetricsTimeSeries?' +
      parameters.join('&'),
    { method: 'get' },
    'GBP Performance fetchMultiDailyMetricsTimeSeries',
  );
  return {
    startDate: dateKey_(startDate),
    endDate: dateKey_(endDate),
    metrics: gbpPerformanceSummary_(response),
  };
}

function gbpReviewAvailability_(attempt) {
  if (attempt && attempt.available) {
    return { status: 'available', reason: '' };
  }
  const reason = String(
    attempt && attempt.error || 'GBP口コミ: 取得できませんでした。',
  );
  const isLegacyReviewService =
    /(mybusiness\.googleapis\.com|Google My Business API)/i.test(reason);
  const isServiceAvailabilityError =
    /(403|SERVICE_DISABLED|has not been used|disabled|accessNotConfigured)/i
      .test(reason);
  return {
    status:
      isLegacyReviewService && isServiceAvailabilityError
        ? 'unavailable/pending'
        : 'unavailable',
    reason: reason,
  };
}

function meoConnectionOutcome_(attributes, voice, reviews, performance) {
  const reviewAvailability = gbpReviewAvailability_(reviews);
  const blockingErrors = [
    attributes && attributes.error,
    voice && voice.error,
    performance && performance.error,
  ].filter(Boolean);
  if (reviewAvailability.status === 'unavailable') {
    blockingErrors.push(reviewAvailability.reason);
  }
  const notices = [
    attributes && attributes.error,
    voice && voice.error,
    performance && performance.error,
    reviewAvailability.reason,
  ].filter(Boolean);
  return {
    status: blockingErrors.length ? 'partial' : 'connected',
    reason: notices.join(' / '),
    blockingReason: blockingErrors.join(' / '),
    reviewStatus: reviewAvailability.status,
    reviewReason: reviewAvailability.reason,
  };
}

function normalizeComparable_(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-‐‑‒–—―ー・,，.。]/g, '');
}

function normalizeWebsite_(value) {
  return String(value || '').trim().replace(/\/+$/g, '').toLowerCase();
}

function normalizeJapanPhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.indexOf('81') === 0 ? '0' + digits.slice(2) : digits;
}

function formatGbpAddress_(address) {
  if (!address) return '';
  return [
    address.administrativeArea,
    address.locality,
  ].concat(address.addressLines || []).filter(Boolean).join('');
}

function gbpPrimaryPhone_(location) {
  const phones = location && location.phoneNumbers || {};
  return phones.primaryPhone || (phones.additionalPhones || [])[0] || '';
}

function gbpTimeText_(time) {
  if (!time) return '';
  const hour = String(time.hours === undefined ? 0 : time.hours).padStart(2, '0');
  const minute = String(time.minutes === undefined ? 0 : time.minutes).padStart(2, '0');
  return hour + ':' + minute;
}

function gbpHoursMap_(regularHours) {
  const days = [
    'SUNDAY',
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
  ];
  const map = {};
  days.forEach(function (day) {
    map[day] = 'closed';
  });
  ((regularHours && regularHours.periods) || []).forEach(function (period) {
    const day = period.openDay;
    if (!day) return;
    const range = gbpTimeText_(period.openTime) + '-' +
      gbpTimeText_(period.closeTime);
    map[day] = map[day] === 'closed' ? range : map[day] + ',' + range;
  });
  return map;
}

function compareGbpLocation_(location) {
  const current = {
    name: String(location && location.title || ''),
    address: formatGbpAddress_(location && location.storefrontAddress),
    phone: gbpPrimaryPhone_(location),
    website: String(location && location.websiteUri || ''),
    hours: gbpHoursMap_(location && location.regularHours),
  };
  const differences = [];
  if (normalizeComparable_(current.name) !== normalizeComparable_(KEA_GBP_EXPECTED.name)) {
    differences.push({ field: '店舗名', current: current.name, expected: KEA_GBP_EXPECTED.name });
  }
  if (
    normalizeComparable_(current.address) !==
    normalizeComparable_(KEA_GBP_EXPECTED.address)
  ) {
    differences.push({ field: '住所', current: current.address, expected: KEA_GBP_EXPECTED.address });
  }
  if (normalizeJapanPhone_(current.phone) !== normalizeJapanPhone_(KEA_GBP_EXPECTED.phone)) {
    differences.push({ field: '電話番号', current: current.phone, expected: KEA_GBP_EXPECTED.phone });
  }
  if (normalizeWebsite_(current.website) !== normalizeWebsite_(KEA_GBP_EXPECTED.website)) {
    differences.push({ field: 'Webサイト', current: current.website, expected: KEA_GBP_EXPECTED.website });
  }
  const hoursMatch = Object.keys(KEA_GBP_EXPECTED.hours).every(function (day) {
    return current.hours[day] === KEA_GBP_EXPECTED.hours[day];
  });
  if (!hoursMatch) {
    differences.push({
      field: '通常営業時間',
      current: JSON.stringify(current.hours),
      expected: JSON.stringify(KEA_GBP_EXPECTED.hours),
    });
  }
  return {
    current: current,
    differences: differences,
    businessInfoMatches: differences.filter(function (item) {
      return ['店舗名', '住所', '電話番号'].indexOf(item.field) >= 0;
    }).length === 0,
    websiteMatches: differences.filter(function (item) {
      return item.field === 'Webサイト';
    }).length === 0,
    hoursMatch: hoursMatch,
  };
}

function unansweredGbpReviews_(reviews) {
  return (reviews || []).filter(function (review) {
    return !review.reviewReply;
  });
}

function gbpStarNumber_(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[String(starRating || '')] || 0;
}

function gbpReplyDraft_(review) {
  const name = String(
    review && review.reviewer && review.reviewer.displayName || 'お客様',
  );
  const stars = gbpStarNumber_(review && review.starRating);
  if (stars >= 4) {
    return name + '様、ご来店とご評価をありがとうございます。またのご来店をお待ちしております。';
  }
  if (stars === 3) {
    return name + '様、ご来店とご評価をありがとうございます。いただいた内容を今後の店舗運営に生かします。';
  }
  return name + '様、ご来店とご意見をありがとうございます。内容を確認し、改善が必要な点を見直します。';
}

function meoConnectionState_(locationId, apiAvailable, reason) {
  if (!String(locationId || '').trim()) {
    return { available: false, status: 'needs_setup', reason: 'GBP_LOCATION_ID未設定' };
  }
  if (!apiAvailable) {
    return { available: false, status: 'failed', reason: reason || 'API接続失敗' };
  }
  return { available: true, status: 'connected', reason: '' };
}

function gbpSetupAction_(reason) {
  if (/GBP_LOCATION_ID未設定/.test(reason)) {
    return 'Apps Script > プロジェクトの設定 > スクリプト プロパティにGBP_ACCOUNT_IDとGBP_LOCATION_IDを候補一覧の値で追加します。';
  }
  if (/(SERVICE_DISABLED|has not been used|API has not been used|accessNotConfigured)/i.test(reason)) {
    return 'Google Cloud kea-growth-ops-api > APIとサービス > ライブラリでBusiness Profile関連APIを有効化します。';
  }
  if (/(insufficient|scope|permission|403|401)/i.test(reason)) {
    return 'Apps ScriptでrunMeoHealthAuditNow()を1回実行し、business.manage権限を許可します。API利用許可がない場合はGoogle Business Profile APIの利用申請を確認します。';
  }
  return 'Google CloudのAPI利用許可、OAuth権限、GBP_ACCOUNT_ID、GBP_LOCATION_IDを確認します。';
}

function gbpReviewSetupAction_(outcome) {
  if (outcome.blockingReason) {
    return gbpSetupAction_(outcome.blockingReason);
  }
  if (outcome.reviewStatus !== 'unavailable/pending') {
    return gbpSetupAction_(outcome.reason);
  }
  return 'Google Cloud kea-growth-ops-apiでmybusiness.googleapis.comの有効状態、承認アカウントからのAPI Library表示、Service Usage制約を確認します。口コミ監視のみunavailable/pendingとして、他の監視を継続します。';
}

function writeGbpConnection_(state) {
  appendHealthRow_('GbpConnection', [
    state.checkedAt,
    state.status,
    state.reason,
    'https://www.googleapis.com/auth/business.manage',
    state.accountId || '',
    state.locationId || '',
    JSON.stringify(state.candidates || []),
    state.manualAction || '',
  ]);
}

function meoHealthRecommendations_(comparison, voice, unanswered, localLink) {
  const recommendations = [];
  (comparison.differences || []).forEach(function (difference) {
    const impactByField = {
      '店舗名': 'Google検索・Googleマップ上の店舗認知',
      '住所': '来店経路・地図案内・ローカル検索',
      '電話番号': '電話問い合わせ・店舗情報の信頼性',
      'Webサイト': 'Google検索・GoogleマップからECサイトへの流入',
      '通常営業時間': '来店判断・営業時間表示・ユーザー体験',
    };
    recommendations.push(
      healthRecommendation_(
        'MEO',
        'field|' + difference.field,
        'Googleビジネスプロフィール',
        '高',
        difference.field,
        '現在値: ' + difference.current +
          ' / 期待値: ' + difference.expected +
          ' / 変更理由: 登録値をKea.の確定情報と一致させる' +
          ' / 影響範囲: ' + (impactByField[difference.field] || '店舗情報表示'),
        '操作画面: Google ビジネス プロフィール > ビジネス情報 > ' +
          difference.field + '。承認後に手動変更します。',
      ),
    );
  });
  if (voice && voice.hasVoiceOfMerchant === false) {
    recommendations.push(
      healthRecommendation_(
        'MEO',
        'voice-of-merchant',
        'GBPオーナー確認',
        '高',
        'Kea.',
        JSON.stringify(voice),
        'Google ビジネス プロフィール > 設定 > ビジネス プロフィールの設定で確認状態と推奨操作を確認します。',
      ),
    );
  }
  (unanswered || []).slice(0, 20).forEach(function (review) {
    const reviewId = review.reviewId || review.name || review.updateTime || '';
    recommendations.push(
      healthRecommendation_(
        'MEO',
        'review|' + reviewId,
        '口コミ返信案',
        '中',
        review.reviewer && review.reviewer.displayName || reviewId,
        '評価 ' + gbpStarNumber_(review.starRating) +
          ' / ' + String(review.comment || '').slice(0, 300),
        'Google ビジネス プロフィール > 口コミで確認後に返信します。返信案: ' +
          gbpReplyDraft_(review),
      ),
    );
  });
  if (localLink && localLink.status !== 'linked') {
    recommendations.push(
      healthRecommendation_(
        'MEO',
        'local-inventory-link|' + localLink.status,
        'ローカル在庫リンク',
        '高',
        'Merchant CenterとGoogleビジネスプロフィール',
        (localLink.reason || 'リンクを確認できませんでした。') +
          ' / 店舗候補 ' + JSON.stringify(localLink.candidates || []),
        'Merchant Center > 設定 > ビジネス情報で店舗候補を確認し、承認後に手動リンクします。',
      ),
    );
  }
  return recommendations;
}

function runMeoHealthAuditCore_(config, merchantResult) {
  const checkedAt = isoTimestamp_(new Date());
  const configuredAccount = gbpAccountName_(config.GBP_ACCOUNT_ID);
  const configuredLocation = gbpLocationName_(config.GBP_LOCATION_ID);
  if (!configuredLocation) {
    let discovery = { accounts: [], candidates: [], errors: [] };
    let reason = 'GBP_LOCATION_ID未設定';
    try {
      discovery = discoverGbpCandidates_();
      if (discovery.errors.length) reason += ' / ' + discovery.errors.join(' / ');
    } catch (error) {
      reason += ' / ' + String(error && error.message || error);
    }
    const manualAction = gbpSetupAction_(reason);
    const connection = {
      checkedAt: checkedAt,
      status: 'needs_setup',
      reason: reason,
      accountId: configuredAccount,
      locationId: '',
      candidates: discovery.candidates,
      manualAction: manualAction,
    };
    writeGbpConnection_(connection);
    appendHealthRow_('MEOHealth', [
      checkedAt, 'needs_setup', '', '', '', '', '', '', '', '', '', '',
      '', '', '', '', false, false, false, 'unknown', '接続設定待ち', manualAction,
      '', '', '', '', '', '', '', '', '',
    ]);
    return {
      source: 'MEO',
      available: false,
      connectionStatus: 'needs_setup',
      reason: reason,
      state: { connectionStatus: 'needs_setup', reason: reason },
      recommendations: [
        healthRecommendation_(
          'MEO',
          'connection-setup',
          'GBP接続',
          '高',
          'Googleビジネスプロフィール',
          reason + ' / 候補 ' + JSON.stringify(discovery.candidates),
          manualAction,
        ),
      ],
      notificationIssues: [],
      candidates: discovery.candidates,
      checkedAt: checkedAt,
    };
  }

  let location;
  try {
    location = getGbpLocation_(configuredLocation);
  } catch (error) {
    const reason = String(error && error.message || error);
    const manualAction = gbpSetupAction_(reason);
    writeGbpConnection_({
      checkedAt: checkedAt,
      status: 'failed',
      reason: reason,
      accountId: configuredAccount,
      locationId: configuredLocation,
      candidates: [],
      manualAction: manualAction,
    });
    throw new Error(reason + ' / ' + manualAction);
  }

  const attributes = healthAttempt_('GBP属性', function () {
    return getGbpAttributes_(configuredLocation);
  }, {});
  const voice = healthAttempt_('GBP確認状態', function () {
    return getGbpVoiceState_(configuredLocation);
  }, null);
  const reviews = healthAttempt_('GBP口コミ', function () {
    return collectGbpReviews_(configuredAccount, configuredLocation);
  }, { reviews: [], totalReviewCount: null, averageRating: null });
  const performance = healthAttempt_('GBP Performance', function () {
    return collectGbpPerformance_(configuredLocation);
  }, {
    startDate: '',
    endDate: '',
    metrics: {
      businessImpressions: null,
      websiteClicks: null,
      callClicks: null,
      directionRequests: null,
    },
  });
  const comparison = compareGbpLocation_(location);
  const unanswered = reviews.available
    ? unansweredGbpReviews_(reviews.value.reviews)
    : [];
  const latestReviewAt = reviews.available && reviews.value.reviews.length
    ? reviews.value.reviews.map(function (review) {
        return review.updateTime || review.createTime || '';
      }).sort().reverse()[0]
    : '';
  let localLink =
    merchantResult && merchantResult.localInventoryLink
      ? merchantResult.localInventoryLink
      : null;
  if (!localLink && String(config.MERCHANT_ACCOUNT_ID || '').trim()) {
    localLink = collectMerchantGbpLinks_(
      String(config.MERCHANT_ACCOUNT_ID).replace(/\D/g, ''),
    );
  }
  localLink = localLink || {
    available: false,
    status: 'unknown',
    reason: 'Merchant接続結果なし',
  };
  localLink.candidates = [
    {
      accountId: configuredAccount,
      locationId: configuredLocation,
      title: comparison.current.name,
      address: comparison.current.address,
    },
  ];
  const recommendations = meoHealthRecommendations_(
    comparison,
    voice.value,
    unanswered,
    localLink,
  );
  const connection = meoConnectionOutcome_(
    attributes,
    voice,
    reviews,
    performance,
  );
  const connectionStatus = connection.status;
  const reviewCount = reviews.available
    ? reviews.value.totalReviewCount
    : null;
  const averageRating = reviews.available
    ? reviews.value.averageRating
    : null;
  const state = {
    connectionStatus: connectionStatus,
    businessInfoMatches: comparison.businessInfoMatches,
    hoursMatch: comparison.hoursMatch,
    websiteMatches: comparison.websiteMatches,
    ownerVerified: voice.available
      ? voice.value.hasVoiceOfMerchant === true
      : null,
    reviewCount: reviewCount,
    averageRating: averageRating,
    unansweredReviews: reviews.available ? unanswered.length : null,
    unansweredReviewIds: unanswered.map(function (review) {
      return review.reviewId || review.name || review.updateTime || '';
    }),
    reviewsStatus: connection.reviewStatus,
    reviewsReason: connection.reviewReason,
    performanceStatus: performance.available ? 'available' : 'unavailable',
    performancePeriod:
      performance.available
        ? performance.value.startDate + '..' + performance.value.endDate
        : '',
    performance: performance.value.metrics,
    localInventoryLinkStatus: localLink.status,
  };
  const notificationIssues = [];
  comparison.differences.forEach(function (difference) {
    notificationIssues.push({
      key: 'MEO|difference|' + difference.field,
      text: 'Googleビジネスプロフィール差異: ' + difference.field,
    });
  });
  unanswered.forEach(function (review) {
    const reviewId = review.reviewId || review.name || review.updateTime || '';
    notificationIssues.push({
      key: 'MEO|unanswered-review|' + reviewId,
      text: '新しい未返信口コミ: ' +
        String(review.reviewer && review.reviewer.displayName || reviewId),
    });
  });
  if (localLink.status !== 'linked') {
    notificationIssues.push({
      key: 'MEO|local-inventory-link|' + localLink.status,
      text: 'ローカル在庫リンク状態: ' + localLink.status,
    });
  }
  const primaryCategory =
    location.categories && location.categories.primaryCategory || {};
  const additionalCategories =
    location.categories && location.categories.additionalCategories || [];
  const manualActions = [
    connection.blockingReason,
    connection.reviewStatus === 'unavailable/pending'
      ? '口コミ監視: unavailable/pending / ' + connection.reviewReason
      : '',
  ].filter(Boolean);
  writeGbpConnection_({
    checkedAt: checkedAt,
    status: connectionStatus,
    reason: connection.reason,
    accountId: configuredAccount,
    locationId: configuredLocation,
    candidates: [],
    manualAction:
      connection.reason ? gbpReviewSetupAction_(connection) : '',
  });
  appendHealthRow_('MEOHealth', [
    checkedAt,
    connectionStatus,
    comparison.current.name,
    comparison.current.address,
    comparison.current.phone,
    comparison.current.website,
    JSON.stringify(comparison.current.hours),
    JSON.stringify(location.specialHours || {}),
    primaryCategory.displayName || primaryCategory.name || '',
    additionalCategories.map(function (item) {
      return item.displayName || item.name || '';
    }).join(', '),
    JSON.stringify(attributes.value || {}),
    voice.available ? voice.value.hasVoiceOfMerchant === true : '',
    reviewCount === null ? '' : reviewCount,
    averageRating === null ? '' : averageRating,
    reviews.available ? unanswered.length : '',
    latestReviewAt,
    comparison.businessInfoMatches,
    comparison.hoursMatch,
    comparison.websiteMatches,
    localLink.status,
    comparison.differences.length
      ? comparison.differences.map(function (item) {
          return item.field;
        }).join(', ')
      : '差異なし',
    manualActions.join(' / '),
    connection.reviewStatus,
    connection.reviewReason,
    performance.available ? 'available' : 'unavailable',
    performance.available
      ? performance.value.startDate + '..' + performance.value.endDate
      : '',
    performance.available ? performance.value.metrics.businessImpressions : '',
    performance.available ? performance.value.metrics.websiteClicks : '',
    performance.available ? performance.value.metrics.callClicks : '',
    performance.available ? performance.value.metrics.directionRequests : '',
    performance.error,
  ]);
  return {
    source: 'MEO',
    available: true,
    connectionStatus: connectionStatus,
    reason: connection.reason,
    state: state,
    recommendations: recommendations,
    notificationIssues: notificationIssues,
    candidates: [],
    checkedAt: checkedAt,
  };
}

function runMeoHealthAudit() {
  return withScriptLock_('runMeoHealthAudit', function () {
    const startedAt = new Date();
    ensureHealthSheets_();
    const result = runHealthMonitorSafely_('MEO', function () {
      return runMeoHealthAuditCore_(keaConfig_(), null);
    });
    return finishSingleHealthWatch_(
      'MEO',
      result,
      'runMeoHealthAudit',
      startedAt,
    );
  });
}

function runMeoHealthAuditNow() {
  return runMeoHealthAudit();
}
