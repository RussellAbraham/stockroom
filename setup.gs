
/**
 * Safely initializes the Stockroom spreadsheet.
 *
 * - Creates missing sheets.
 * - Adds headers to empty sheets.
 * - Preserves existing rows.
 * - Stops if an existing sheet has unexpected headers.
 *
 * Run manually from the Apps Script editor.
 */
function setupStockroom() {
  var spreadsheet = getStockroomSpreadsheet_();
  var sheetNames = Object.keys(STOCKROOM_SCHEMA);
  var existingSheets = {};

  // Preflight existing sheets before making changes.
  sheetNames.forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);

    existingSheets[sheetName] = sheet;

    if (!sheet) {
      return;
    }

    if (sheet.getLastRow() === 0 &&
        sheet.getLastColumn() === 0) {
      return;
    }

    var expectedHeaders = STOCKROOM_SCHEMA[sheetName];
    var actualHeaders = sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .getValues()[0];

    var matches = expectedHeaders.every(function (
      expected,
      index
    ) {
      return actualHeaders[index] === expected;
    });

    if (!matches) {
      throw new Error(
        'Unexpected headers in "' + sheetName +
        '". No sheets were initialized. ' +
        'Review the existing sheet before retrying.'
      );
    }
  });

  // Create missing sheets and initialize empty sheets.
  sheetNames.forEach(function (sheetName) {
    var sheet = existingSheets[sheetName];

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    if (sheet.getLastRow() === 0 &&
        sheet.getLastColumn() === 0) {
      var headers = STOCKROOM_SCHEMA[sheetName];

      sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers]);

      sheet.setFrozenRows(1);
    }
  });

  return {
    ok: true,
    message: 'Stockroom sheets initialized.',
    sheets: sheetNames
  };
}
