function doGet(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  if (parameters.format === 'json') {
    return ContentService.createTextOutput(
      JSON.stringify(readDashboardData_()),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const page = parameters.page === 'sale' ? 'SaleBulk' : 'Dashboard';
  const title = page === 'SaleBulk'
    ? 'Kea. SALE一括設定'
    : 'Kea. Growth Dashboard';
  return HtmlService.createTemplateFromFile(page)
    .evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData() {
  return JSON.parse(JSON.stringify(readDashboardData_()));
}
