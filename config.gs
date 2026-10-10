
/**
 * Returns the configured Stockroom spreadsheet.
 * The spreadsheet ID is stored in Script Properties,
 * not hardcoded in application source.
 */
function getStockroomSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty(
    'STOCKROOM_SPREADSHEET_ID'
  );

  if (!spreadsheetId || !spreadsheetId.trim()) {
    throw new Error(
      'Missing Script Property: STOCKROOM_SPREADSHEET_ID'
    );
  }

  return SpreadsheetApp.openById(spreadsheetId.trim());
}
