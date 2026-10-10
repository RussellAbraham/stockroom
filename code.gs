
/**
 * Serves the Stockroom application shell.
 * No inventory operations or spreadsheet access are implemented yet.
 */
function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('Stockroom');
}

/**
 * Minimal server-side health check used by the smoke test.
 */
function getHealthStatus() {
  return {
    ok: true,
    application: 'Stockroom',
    status: 'ready'
  };
}
