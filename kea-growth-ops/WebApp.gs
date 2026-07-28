function doGet(event) {
  if (
    event &&
    event.parameter &&
    event.parameter.format === 'json'
  ) {
    return ContentService.createTextOutput(
      JSON.stringify(readDashboardData_()),
    ).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('Kea. Growth Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData() {
  return readDashboardData_();
}
