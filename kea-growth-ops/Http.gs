function fetchJson_(url, options, label) {
  const request = Object.assign(
    {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
    },
    options || {},
  );
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = UrlFetchApp.fetch(url, request);
    const status = response.getResponseCode();
    const body = response.getContentText();
    if (status >= 200 && status < 300) {
      if (!body) return {};
      try {
        return JSON.parse(body);
      } catch (error) {
        throw new Error((label || url) + ' returned invalid JSON');
      }
    }
    lastError = new Error(
      (label || url) +
        ' failed (' +
        status +
        '): ' +
        body.slice(0, 800),
    );
    if (status !== 429 && status < 500) break;
    Utilities.sleep(Math.min(8000, attempt * 1200));
  }
  throw lastError;
}

function googleJson_(url, options, label) {
  const request = Object.assign({}, options || {});
  request.headers = Object.assign(
    {},
    request.headers || {},
    { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  );
  if (request.payload && typeof request.payload !== 'string') {
    request.contentType = request.contentType || 'application/json';
    request.payload = JSON.stringify(request.payload);
  }
  return fetchJson_(url, request, label);
}

function shopifyAccessToken_(config) {
  const direct = String(config.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
  if (direct) return direct;
  if (!configured_(config, ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])) {
    throw new Error(
      'Shopify tokenまたはSHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRETが未設定です。',
    );
  }
  const cache = CacheService.getScriptCache();
  const cached = cache.get('KEA_SHOPIFY_ACCESS_TOKEN');
  if (cached) return cached;
  const url =
    'https://' +
    config.SHOPIFY_STORE_DOMAIN +
    '/admin/oauth/access_token';
  const payload = fetchJson_(
    url,
    {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        grant_type: 'client_credentials',
        client_id: config.SHOPIFY_CLIENT_ID,
        client_secret: config.SHOPIFY_CLIENT_SECRET,
      },
    },
    'Shopify client credentials',
  );
  if (!payload.access_token) {
    throw new Error('Shopify access tokenを取得できませんでした。');
  }
  cache.put('KEA_SHOPIFY_ACCESS_TOKEN', payload.access_token, 3300);
  return payload.access_token;
}

function shopifyGraphql_(config, query, variables, label) {
  const url =
    'https://' +
    config.SHOPIFY_STORE_DOMAIN +
    '/admin/api/' +
    config.SHOPIFY_API_VERSION +
    '/graphql.json';
  const response = fetchJson_(
    url,
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Shopify-Access-Token': shopifyAccessToken_(config),
      },
      payload: JSON.stringify({
        query: query,
        variables: variables || {},
      }),
    },
    label || 'Shopify GraphQL',
  );
  if (response.errors && response.errors.length) {
    throw new Error(
      (label || 'Shopify GraphQL') +
        ': ' +
        response.errors
          .map(function (error) {
            return error.message;
          })
          .join(' | '),
    );
  }
  return response.data;
}

function googleAdsSearch_(config, query) {
  if (
    !configured_(config, [
      'GOOGLE_ADS_CUSTOMER_ID',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
    ])
  ) {
    return { available: false, reason: 'Google Ads設定未完了', rows: [] };
  }
  const customerId = String(config.GOOGLE_ADS_CUSTOMER_ID).replace(/\D/g, '');
  const headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'developer-token': String(config.GOOGLE_ADS_DEVELOPER_TOKEN).trim(),
  };
  if (String(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').trim()) {
    headers['login-customer-id'] = String(
      config.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    ).replace(/\D/g, '');
  }
  const url =
    'https://googleads.googleapis.com/' +
    config.GOOGLE_ADS_API_VERSION +
    '/customers/' +
    customerId +
    '/googleAds:searchStream';
  const batches = fetchJson_(
    url,
    {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify({ query: query }),
    },
    'Google Ads searchStream',
  );
  const rows = [];
  (Array.isArray(batches) ? batches : [batches]).forEach(function (batch) {
    (batch.results || []).forEach(function (row) {
      rows.push(row);
    });
  });
  return { available: true, rows: rows };
}

function openAiNarrative_(config, instructions, input) {
  if (
    String(config.AI_MODE || '').toUpperCase() !== 'OPENAI' ||
    !String(config.OPENAI_API_KEY || '').trim()
  ) {
    return null;
  }
  const response = fetchJson_(
    'https://api.openai.com/v1/responses',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + String(config.OPENAI_API_KEY).trim(),
      },
      payload: JSON.stringify({
        model: config.OPENAI_MODEL || KEA_DEFAULTS.OPENAI_MODEL,
        reasoning: { effort: 'low' },
        instructions: instructions,
        input: JSON.stringify(input),
        max_output_tokens: 1800,
      }),
    },
    'OpenAI Responses API',
  );
  const message = (response.output || []).find(function (item) {
    return item.type === 'message';
  });
  const outputText = (message && message.content
    ? message.content
    : []
  ).find(function (item) {
    return item.type === 'output_text';
  });
  return outputText ? outputText.text : null;
}
