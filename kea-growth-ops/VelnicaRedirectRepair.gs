const KEA_VELNICA_OLD_PATH_ = '/store/products/list.php?category_id=23';
const KEA_VELNICA_NEW_PATH_ = '/collections/velnica';

/**
 * Idempotent repair for the verified broken old-EC Velnica URL.
 * Reads first, creates only when no exact path exists, and updates only its exact path.
 */
function repairVerifiedVelnicaOldRedirectNow() {
  const config = keaConfig_();
  const lookup = shopifyGraphql_(
    config,
    'query KeaFindVelnicaRedirect($query: String!) {' +
      ' urlRedirects(first: 50, query: $query) { nodes { id path target } }' +
    '}',
    { query: KEA_VELNICA_OLD_PATH_ },
    'Find verified Velnica old URL redirect',
  );
  const matches = ((lookup.urlRedirects && lookup.urlRedirects.nodes) || []).filter(function(item) {
    return item.path === KEA_VELNICA_OLD_PATH_;
  });
  if (matches.length > 1) {
    throw new Error('Velnica old URL redirect is not unique; no mutation was made');
  }
  if (matches.length === 1 && matches[0].target === KEA_VELNICA_NEW_PATH_) {
    return { status: 'already_correct', path: KEA_VELNICA_OLD_PATH_, target: KEA_VELNICA_NEW_PATH_ };
  }
  let payload;
  if (matches.length === 1) {
    payload = shopifyGraphql_(
      config,
      'mutation KeaUpdateVelnicaRedirect($id: ID!, $urlRedirect: UrlRedirectInput!) {' +
        ' urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {' +
        '  urlRedirect { id path target } userErrors { field message } } }',
      { id: matches[0].id, urlRedirect: { path: KEA_VELNICA_OLD_PATH_, target: KEA_VELNICA_NEW_PATH_ } },
      'Repair verified Velnica old URL redirect',
    );
    const errors = payload.urlRedirectUpdate && payload.urlRedirectUpdate.userErrors || [];
    if (errors.length) throw new Error(JSON.stringify(errors));
    return { status: 'updated', redirect: payload.urlRedirectUpdate.urlRedirect };
  }
  payload = shopifyGraphql_(
    config,
    'mutation KeaCreateVelnicaRedirect($urlRedirect: UrlRedirectInput!) {' +
      ' urlRedirectCreate(urlRedirect: $urlRedirect) {' +
      '  urlRedirect { id path target } userErrors { field message } } }',
    { urlRedirect: { path: KEA_VELNICA_OLD_PATH_, target: KEA_VELNICA_NEW_PATH_ } },
    'Create verified Velnica old URL redirect',
  );
  const errors = payload.urlRedirectCreate && payload.urlRedirectCreate.userErrors || [];
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { status: 'created', redirect: payload.urlRedirectCreate.urlRedirect };
}
