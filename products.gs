
/**
 * Returns a standard service error.
 */
function productServiceError_(code, message, field) {
  var error = {
    code: code,
    message: message
  };

  if (field) {
    error.field = field;
  }

  return {
    ok: false,
    error: error
  };
}

/**
 * Validates that a sheet's header row matches the schema.
 * Returns a map of column names to zero-based indexes.
 */
function getProductHeaderMap_(sheet, expectedHeaders) {
  if (!sheet || sheet.getLastRow() < 1) {
    throw new Error('Products sheet is missing or empty.');
  }

  var actualHeaders = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0];

  var headerMap = {};

  expectedHeaders.forEach(function (header, index) {
    if (actualHeaders[index] !== header) {
      throw new Error(
        'Unexpected Products sheet header at column ' +
        (index + 1) + '. Expected "' + header + '".'
      );
    }

    headerMap[header] = index;
  });

  return headerMap;
}

/**
 * Creates a product after validating its input.
 *
 * Duplicate SKUs are rejected without regard to case.
 * The script lock prevents concurrent create requests
 * from passing the duplicate check simultaneously.
 */
function createProduct(input) {
  var validation = validateProductInput(input);

  if (!validation.ok) {
    return validation;
  }

  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return productServiceError_(
      'SERVICE_BUSY',
      'Stockroom is busy. Please try again.'
    );
  }

  try {
    var spreadsheet = getStockroomSpreadsheet_();
    var sheet = spreadsheet.getSheetByName('Products');

    if (!sheet) {
      throw new Error(
        'Products sheet not found. Run setupStockroom() first.'
      );
    }

    var headers = STOCKROOM_SCHEMA.Products;
    var headerMap = getProductHeaderMap_(sheet, headers);
    var lastRow = sheet.getLastRow();
    var normalizedSku = validation.data.sku.toLowerCase();

    // Check existing SKUs while holding the script lock.
    if (lastRow > 1) {
      var skuValues = sheet
        .getRange(2, headerMap.sku + 1, lastRow - 1, 1)
        .getValues();

      var duplicateFound = skuValues.some(function (row) {
        return String(row[0]).trim().toLowerCase() ===
          normalizedSku;
      });

      if (duplicateFound) {
        return productServiceError_(
          'DUPLICATE_SKU',
          'A product with this SKU already exists.',
          'sku'
        );
      }
    }

    var now = new Date();
    var product = {
      productId: Utilities.getUuid(),
      sku: validation.data.sku,
      name: validation.data.name,
      description: validation.data.description,
      unit: validation.data.unit,
      reorderLevel: validation.data.reorderLevel,
      isArchived: false,
      createdAt: now,
      updatedAt: now
    };

    var row = headers.map(function (header) {
      return product[header];
    });

    sheet.getRange(lastRow + 1, 1, 1, row.length)
      .setValues([row]);

    // Return JSON-friendly timestamps for google.script.run.
    var responseProduct = {};

    headers.forEach(function (header) {
      var value = product[header];

      responseProduct[header] =
        value instanceof Date ? value.toISOString() : value;
    });

    return {
      ok: true,
      data: responseProduct
    };
  } catch (error) {
    console.error('createProduct failed: ' + error.message);

    return productServiceError_(
      'STORAGE_ERROR',
      'The product could not be saved. Please try again.'
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns all products, including archived products.
 * The frontend can filter archived products as needed.
 */
function listProducts() {
  try {
    var spreadsheet = getStockroomSpreadsheet_();
    var sheet = spreadsheet.getSheetByName('Products');

    if (!sheet) {
      throw new Error(
        'Products sheet not found. Run setupStockroom() first.'
      );
    }

    var headers = STOCKROOM_SCHEMA.Products;
    var headerMap = getProductHeaderMap_(sheet, headers);
    var lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return {
        ok: true,
        data: []
      };
    }

    var values = sheet
      .getRange(2, 1, lastRow - 1, headers.length)
      .getValues();

    var products = values.map(function (row) {
      var product = {};

      headers.forEach(function (header) {
        var value = row[headerMap[header]];

        if (value instanceof Date) {
          value = value.toISOString();
        }

        product[header] = value;
      });

      return product;
    });

    return {
      ok: true,
      data: products
    };
  } catch (error) {
    console.error('listProducts failed: ' + error.message);

    return productServiceError_(
      'STORAGE_ERROR',
      'Products could not be loaded. Please try again.'
    );
  }
}
