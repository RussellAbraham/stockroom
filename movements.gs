
/**
 * Returns a consistent stock movement service error.
 */
function movementServiceError_(code, message, field) {
  return {
    ok: false,
    error: {
      code: code,
      message: message,
      field: field || null
    }
  };
}

/**
 * Maps expected headers to their 1-based column positions.
 * Column order may differ, but required headers must exist.
 */
function getMovementHeaderMap_(sheet, expectedHeaders) {
  if (!sheet || sheet.getLastRow() < 1) {
    throw new Error('Required sheet or header row is missing.');
  }

  var headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  var map = {};

  headers.forEach(function (header, index) {
    var name = String(header).trim();

    if (name) {
      if (map[name] !== undefined) {
        throw new Error('Duplicate column header: ' + name);
      }

      map[name] = index + 1;
    }
  });

  expectedHeaders.forEach(function (header) {
    if (map[header] === undefined) {
      throw new Error('Missing required column: ' + header);
    }
  });

  return map;
}

/**
 * Reads data rows from a sheet.
 */
function getMovementRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, lastColumn)
    .getValues();
}

/**
 * Reads a field from a row using a header map.
 */
function getMovementField_(row, headerMap, field) {
  return row[headerMap[field] - 1];
}

/**
 * Returns the current stock balance for a product.
 * Caller must hold the script lock.
 */
function calculateStockBalance_(movementSheet, productId) {
  var headerMap = getMovementHeaderMap_(
    movementSheet,
    STOCKROOM_SCHEMA.StockMovements
  );

  var rows = getMovementRows_(movementSheet);
  var balance = 0;

  rows.forEach(function (row) {
    var rowProductId = getMovementField_(
      row, headerMap, 'productId'
    );

    if (rowProductId !== productId) {
      return;
    }

    var delta = getMovementField_(
      row, headerMap, 'quantityDelta'
    );

    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      throw new Error('Invalid quantity delta in stock ledger.');
    }

    balance += delta;
  });

  if (!Number.isFinite(balance)) {
    throw new Error('Calculated stock balance is invalid.');
  }

  return Math.abs(balance) < 1e-9 ? 0 : balance;
}

/**
 * Finds a product by ID and rejects missing or archived products.
 */
function findActiveMovementProduct_(productSheet, productId) {
  var headerMap = getMovementHeaderMap_(
    productSheet,
    STOCKROOM_SCHEMA.Products
  );

  var rows = getMovementRows_(productSheet);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];

    if (
      getMovementField_(row, headerMap, 'productId') !== productId
    ) {
      continue;
    }

    var archived = getMovementField_(
      row, headerMap, 'isArchived'
    );

    if (
      archived === true ||
      String(archived).toLowerCase() === 'true'
    ) {
      return {
        ok: false,
        error: {
          code: 'PRODUCT_ARCHIVED',
          message: 'Archived products cannot receive stock movements.'
        }
      };
    }

    return {
      ok: true,
      data: {
        productId: productId
      }
    };
  }

  return {
    ok: false,
    error: {
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product was not found.'
    }
  };
}

/**
 * Creates a stock movement.
 *
 * input.requestId must be unique and reused for retries of the
 * same request. Actor attribution is temporarily set to "system".
 */
function createStockMovement(input) {
  var validation = validateMovementInput(input);

  if (!validation.ok) {
    return validation;
  }

  if (
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    input.requestId.trim().length > 100
  ) {
    return validationError_(
      'A request ID of 1 to 100 characters is required.',
      'requestId'
    );
  }

  var movement = validation.data;
  var requestId = input.requestId.trim();
  var lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return movementServiceError_(
        'LOCK_UNAVAILABLE',
        'Inventory is busy. Please try again.'
      );
    }

    var spreadsheet = getStockroomSpreadsheet_();
    var productSheet = spreadsheet.getSheetByName('Products');
    var movementSheet = spreadsheet.getSheetByName('StockMovements');

    if (!productSheet || !movementSheet) {
      throw new Error('Required inventory sheets are missing.');
    }

    var productResult = findActiveMovementProduct_(
      productSheet,
      movement.productId
    );

    if (!productResult.ok) {
      return productResult;
    }

    var movementHeaders = getMovementHeaderMap_(
      movementSheet,
      STOCKROOM_SCHEMA.StockMovements
    );

    var existingRows = getMovementRows_(movementSheet);

    for (var i = 0; i < existingRows.length; i++) {
      var existingRequestId = getMovementField_(
        existingRows[i],
        movementHeaders,
        'requestId'
      );

      if (existingRequestId === requestId) {
        return movementServiceError_(
          'DUPLICATE_REQUEST',
          'This request ID has already been used.'
        );
      }
    }

    var currentBalance = calculateStockBalance_(
      movementSheet,
      movement.productId
    );

    var nextBalance = currentBalance + movement.quantityDelta;

    if (nextBalance < -1e-9) {
      return movementServiceError_(
        'INSUFFICIENT_STOCK',
        'This movement would make stock negative.',
        'quantity'
      );
    }

    if (Math.abs(nextBalance) < 1e-9) {
      nextBalance = 0;
    }

    var now = new Date();
    var movementId = Utilities.getUuid();

    var valuesByHeader = {
      movementId: movementId,
      productId: movement.productId,
      type: movement.type,
      quantityDelta: movement.quantityDelta,
      reason: movement.reason,
      createdAt: now,
      actor: 'system',
      requestId: requestId
    };

    var row = [];

    Object.keys(movementHeaders).forEach(function (header) {
      row[movementHeaders[header] - 1] =
        valuesByHeader[header] === undefined
          ? ''
          : valuesByHeader[header];
    });

    // Fill any gaps if the sheet contains extra columns.
    for (var column = 0; column < movementSheet.getLastColumn(); column++) {
      if (row[column] === undefined) {
        row[column] = '';
      }
    }

    movementSheet.appendRow(row);

    return {
      ok: true,
      data: {
        movementId: movementId,
        productId: movement.productId,
        type: movement.type,
        quantityDelta: movement.quantityDelta,
        reason: movement.reason,
        createdAt: now.toISOString(),
        currentBalance: nextBalance,
        requestId: requestId
      }
    };
  } catch (error) {
    console.error('createStockMovement failed: ' + error.message);

    return movementServiceError_(
      'STORAGE_ERROR',
      'Unable to record the stock movement.'
    );
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * Gets a product's current balance from the movement ledger.
 */
function getStockBalance(productId) {
  if (typeof productId !== 'string' || !productId.trim()) {
    return validationError_(
      'Product ID is required.',
      'productId'
    );
  }

  var lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return movementServiceError_(
        'LOCK_UNAVAILABLE',
        'Inventory is busy. Please try again.'
      );
    }

    var spreadsheet = getStockroomSpreadsheet_();
    var productSheet = spreadsheet.getSheetByName('Products');
    var movementSheet = spreadsheet.getSheetByName('StockMovements');

    if (!productSheet || !movementSheet) {
      throw new Error('Required inventory sheets are missing.');
    }

    var productResult = findActiveMovementProduct_(
      productSheet,
      productId.trim()
    );

    if (!productResult.ok) {
      return productResult;
    }

    return {
      ok: true,
      data: {
        productId: productId.trim(),
        currentBalance: calculateStockBalance_(
          movementSheet,
          productId.trim()
        )
      }
    };
  } catch (error) {
    console.error('getStockBalance failed: ' + error.message);

    return movementServiceError_(
      'STORAGE_ERROR',
      'Unable to retrieve the stock balance.'
    );
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * Lists active products with their current stock balances.
 * Uses one script lock for a consistent inventory read.
 */
function listProductsWithStock() {
  var lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return movementServiceError_(
        'LOCK_UNAVAILABLE',
        'Inventory is busy. Please try again.'
      );
    }

    var spreadsheet = getStockroomSpreadsheet_();
    var productSheet = spreadsheet.getSheetByName('Products');
    var movementSheet = spreadsheet.getSheetByName('StockMovements');

    if (!productSheet || !movementSheet) {
      throw new Error('Required inventory sheets are missing.');
    }

    var productHeaders = getMovementHeaderMap_(
      productSheet,
      STOCKROOM_SCHEMA.Products
    );

    var movementHeaders = getMovementHeaderMap_(
      movementSheet,
      STOCKROOM_SCHEMA.StockMovements
    );

    var productRows = getMovementRows_(productSheet);
    var movementRows = getMovementRows_(movementSheet);
    var balances = {};

    movementRows.forEach(function (row) {
      var productId = getMovementField_(
        row,
        movementHeaders,
        'productId'
      );

      var delta = getMovementField_(
        row,
        movementHeaders,
        'quantityDelta'
      );

      if (typeof delta !== 'number' || !Number.isFinite(delta)) {
        throw new Error('Invalid quantity delta in stock ledger.');
      }

      balances[productId] = (balances[productId] || 0) + delta;
    });

    var products = productRows.map(function (row) {
      var productId = getMovementField_(
        row,
        productHeaders,
        'productId'
      );

      var balance = balances[productId] || 0;

      if (!Number.isFinite(balance)) {
        throw new Error('Calculated stock balance is invalid.');
      }

      if (Math.abs(balance) < 1e-9) {
        balance = 0;
      }

      var createdAt = getMovementField_(
        row,
        productHeaders,
        'createdAt'
      );

      var updatedAt = getMovementField_(
        row,
        productHeaders,
        'updatedAt'
      );

      return {
        productId: productId,
        sku: getMovementField_(row, productHeaders, 'sku'),
        name: getMovementField_(row, productHeaders, 'name'),
        description: getMovementField_(row, productHeaders, 'description'),
        unit: getMovementField_(row, productHeaders, 'unit'),
        reorderLevel: getMovementField_(row, productHeaders, 'reorderLevel'),
        isArchived: getMovementField_(row, productHeaders, 'isArchived'),
        createdAt: createdAt instanceof Date
          ? createdAt.toISOString()
          : createdAt,
        updatedAt: updatedAt instanceof Date
          ? updatedAt.toISOString()
          : updatedAt,
        currentBalance: balance
      };
    });

    return {
      ok: true,
      data: products
    };
  } catch (error) {
    console.error('listProductsWithStock failed: ' + error.message);

    return movementServiceError_(
      'STORAGE_ERROR',
      'Unable to retrieve products and stock balances.'
    );
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}
