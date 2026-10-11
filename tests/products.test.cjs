
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createTestEnvironment(options = {}) {
  const sheets = {};

  class FakeSheet {
    constructor() {
      this.rows = [];
    }

    getLastRow() {
      return this.rows.length;
    }

    getLastColumn() {
      return this.rows.reduce(function (max, row) {
        return Math.max(max, row.length);
      }, 0);
    }

    getRange(startRow, startColumn, numRows, numColumns) {
      const sheet = this;

      return {
        getValues() {
          const result = [];

          for (let r = 0; r < numRows; r++) {
            const row = sheet.rows[startRow - 1 + r] || [];

            result.push(
              Array.from(
                { length: numColumns },
                (_, c) => row[startColumn - 1 + c] ?? "",
              ),
            );
          }

          return result;
        },

        setValues(values) {
          values.forEach((valuesRow, r) => {
            const rowIndex = startRow - 1 + r;

            while (sheet.rows.length <= rowIndex) {
              sheet.rows.push([]);
            }

            valuesRow.forEach((value, c) => {
              const columnIndex = startColumn - 1 + c;
              sheet.rows[rowIndex][columnIndex] = value;
            });
          });
        },
      };
    }

    appendRow(values) {
      this.rows.push(values.slice());
    }
  }

  const spreadsheet = {
    getSheetByName(name) {
      return sheets[name] || null;
    },
  };

  const lock = {
    released: false,

    tryLock() {
      return options.lockAvailable !== false;
    },

    hasLock() {
      return this.released === false &&
        options.lockAvailable !== false;
    },

    releaseLock() {
      this.released = true;
    },
  };

  const context = {
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Error,
    Math,
    isNaN,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty() {
            return "fake-spreadsheet-id";
          },
        };
      },
    },
    SpreadsheetApp: {
      openById() {
        if (options.storageFailure) {
          throw new Error("Simulated storage failure");
        }

        return spreadsheet;
      },
    },
    LockService: {
      getScriptLock() {
        return lock;
      },
    },
    Utilities: {
      getUuid() {
        context.uuidCounter = (context.uuidCounter || 0) + 1;
        return `test-id-${context.uuidCounter}`;
      },
    },
    uuidCounter: 0,
  };

  vm.createContext(context);

  for (const file of [
    "schema.gs",
    "validation.gs",
    "products.gs",
    "movements.gs",
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", file),
      "utf8",
    );

    vm.runInContext(source, context, { filename: file });
  }

  // Give tests direct access to the fake spreadsheet.
  context.getStockroomSpreadsheet_ = () => {
    if (options.storageFailure) {
      throw new Error("Simulated storage failure");
    }

    return spreadsheet;
  };

  const productsSheet = new FakeSheet();
  productsSheet.rows.push(context.STOCKROOM_SCHEMA.Products);
  sheets.Products = productsSheet;

  const movementsSheet = new FakeSheet();
  movementsSheet.rows.push(context.STOCKROOM_SCHEMA.StockMovements);
  sheets.StockMovements = movementsSheet;

  return {
    context,
    productsSheet,
    movementsSheet,
    lock,
    options,
  };
}

function validProduct(overrides = {}) {
  return {
    sku: "PART-001",
    name: "Replacement Filter",
    description: "Standard filter",
    unit: "each",
    reorderLevel: 2.5,
    ...overrides,
  };
}

function seedMovementProduct(context) {
  const result = context.createProduct({
    sku: "MOVE-001",
    name: "Movement Test Product",
    description: "",
    unit: "each",
    reorderLevel: 2,
  });

  assert.equal(result.ok, true);
  return result.data.productId;
}

function movementInput(productId, overrides = {}) {
  return {
    productId,
    type: "receipt",
    quantity: 10,
    reason: "Test receipt",
    requestId: "request-001",
    ...overrides,
  };
}

// --------------------------------------------------
// Product tests
// --------------------------------------------------

test("creates a product with generated ID and timestamps", () => {
  const { context, productsSheet } = createTestEnvironment();

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, true);
  assert.equal(result.data.productId, "test-id-1");
  assert.equal(result.data.sku, "PART-001");
  assert.equal(result.data.isArchived, false);
  assert.equal(result.data.reorderLevel, 2.5);
  assert.equal(typeof result.data.createdAt, "string");
  assert.equal(result.data.createdAt, result.data.updatedAt);
  assert.equal(productsSheet.getLastRow(), 2);
});

test("trims product fields before saving", () => {
  const { context, productsSheet } = createTestEnvironment();

  const result = context.createProduct(
    validProduct({
      sku: "  PART-002  ",
      name: "  Storage Bin  ",
      unit: "  box  ",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.sku, "PART-002");
  assert.equal(result.data.name, "Storage Bin");
  assert.equal(result.data.unit, "box");
  assert.equal(productsSheet.getLastRow(), 2);
});

test("rejects duplicate SKUs regardless of case", () => {
  const { context, productsSheet } = createTestEnvironment();

  assert.equal(context.createProduct(validProduct()).ok, true);

  const duplicate = context.createProduct(
    validProduct({ sku: "part-001" }),
  );

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "DUPLICATE_SKU");
  assert.equal(productsSheet.getLastRow(), 2);
});

test("does not write invalid product input", () => {
  const { context, productsSheet, lock } = createTestEnvironment();

  const result = context.createProduct(
    validProduct({ name: " " }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_ERROR");
  assert.equal(productsSheet.getLastRow(), 1);
  assert.equal(lock.released, false);
});

test("returns an empty list when no products exist", () => {
  const { context } = createTestEnvironment();

  const result = context.listProducts();

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.data), []);
});

test("lists saved products", () => {
  const { context } = createTestEnvironment();

  context.createProduct(validProduct());
  context.createProduct(
    validProduct({
      sku: "PART-002",
      name: "Storage Bin",
    }),
  );

  const result = context.listProducts();

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].sku, "PART-001");
  assert.equal(result.data[1].sku, "PART-002");
});

test("releases the lock after a successful product create", () => {
  const { context, lock } = createTestEnvironment();

  context.createProduct(validProduct());

  assert.equal(lock.released, true);
});

test("returns a controlled error when the product lock is unavailable", () => {
  const { context, productsSheet, lock } = createTestEnvironment({
    lockAvailable: false,
  });

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SERVICE_BUSY");
  assert.equal(productsSheet.getLastRow(), 1);
  assert.equal(lock.released, false);
});

test("returns a controlled error when product storage fails", () => {
  const { context } = createTestEnvironment({
    storageFailure: true,
  });

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STORAGE_ERROR");
});

// --------------------------------------------------
// Stock movement tests
// --------------------------------------------------

test("records a receipt and returns the updated balance", () => {
  const { context, movementsSheet } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  const result = context.createStockMovement(
    movementInput(productId),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.quantityDelta, 10);
  assert.equal(result.data.currentBalance, 10);
  assert.equal(movementsSheet.getLastRow(), 2);
});

test("usage decreases the stock balance", () => {
  const { context } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  context.createStockMovement(movementInput(productId));

  const result = context.createStockMovement(
    movementInput(productId, {
      type: "usage",
      quantity: 3,
      requestId: "request-002",
      reason: "Used for testing",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.quantityDelta, -3);
  assert.equal(result.data.currentBalance, 7);

  const balance = context.getStockBalance(productId);

  assert.equal(balance.ok, true);
  assert.equal(balance.data.currentBalance, 7);
});

test("supports positive and negative stock adjustments", () => {
  const { context } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  context.createStockMovement(movementInput(productId));

  const increase = context.createStockMovement(
    movementInput(productId, {
      type: "adjustment",
      quantity: 5,
      requestId: "request-002",
      reason: "Stock count correction",
    }),
  );

  assert.equal(increase.ok, true);
  assert.equal(increase.data.currentBalance, 15);

  const decrease = context.createStockMovement(
    movementInput(productId, {
      type: "adjustment",
      quantity: -2,
      requestId: "request-003",
      reason: "Damaged inventory correction",
    }),
  );

  assert.equal(decrease.ok, true);
  assert.equal(decrease.data.currentBalance, 13);
});

test("rejects usage that would make stock negative", () => {
  const { context, movementsSheet } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  context.createStockMovement(movementInput(productId));

  const result = context.createStockMovement(
    movementInput(productId, {
      type: "usage",
      quantity: 11,
      requestId: "request-002",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INSUFFICIENT_STOCK");
  assert.equal(movementsSheet.getLastRow(), 2);

  const balance = context.getStockBalance(productId);
  assert.equal(balance.data.currentBalance, 10);
});

test("rejects duplicate request IDs without adding another movement", () => {
  const { context, movementsSheet } = createTestEnvironment();
  const productId = seedMovementProduct(context);
  const input = movementInput(productId);

  assert.equal(context.createStockMovement(input).ok, true);

  const duplicate = context.createStockMovement(input);

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "DUPLICATE_REQUEST");
  assert.equal(movementsSheet.getLastRow(), 2);
});

test("rejects movements for nonexistent products", () => {
  const { context, movementsSheet } = createTestEnvironment();

  const result = context.createStockMovement(
    movementInput("missing-product"),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PRODUCT_NOT_FOUND");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("rejects movements for archived products", () => {
  const { context, productsSheet, movementsSheet } =
    createTestEnvironment();

  const productId = seedMovementProduct(context);
  const productHeaders = context.STOCKROOM_SCHEMA.Products;
  const archivedColumn = productHeaders.indexOf("isArchived");
  const productIdColumn = productHeaders.indexOf("productId");

  const productRow = productsSheet.rows.find(
    (row, index) =>
      index > 0 && row[productIdColumn] === productId,
  );

  assert.ok(productRow);
  productRow[archivedColumn] = true;

  const result = context.createStockMovement(
    movementInput(productId),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PRODUCT_ARCHIVED");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("rejects a missing request ID", () => {
  const { context, movementsSheet } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  const result = context.createStockMovement(
    movementInput(productId, { requestId: "" }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_ERROR");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("rejects zero movement quantities", () => {
  const { context, movementsSheet } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  const result = context.createStockMovement(
    movementInput(productId, { quantity: 0 }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_ERROR");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("supports fractional quantities", () => {
  const { context } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  const receipt = context.createStockMovement(
    movementInput(productId, { quantity: 2.75 }),
  );

  assert.equal(receipt.ok, true);
  assert.equal(receipt.data.currentBalance, 2.75);

  const usage = context.createStockMovement(
    movementInput(productId, {
      type: "usage",
      quantity: 0.25,
      requestId: "request-002",
    }),
  );

  assert.equal(usage.ok, true);
  assert.equal(usage.data.currentBalance, 2.5);
});

test("rejects movements when the lock is unavailable", () => {
  const { context, options, movementsSheet } =
    createTestEnvironment();

  const productId = seedMovementProduct(context);
  options.lockAvailable = false;

  const result = context.createStockMovement(
    movementInput(productId),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LOCK_UNAVAILABLE");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("returns a controlled error when movement storage fails", () => {
  const { context, options, movementsSheet } =
    createTestEnvironment();

  const productId = seedMovementProduct(context);
  options.storageFailure = true;

  const result = context.createStockMovement(
    movementInput(productId),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STORAGE_ERROR");
  assert.equal(movementsSheet.getLastRow(), 1);
});

test("releases the movement lock after a successful write", () => {
  const { context, lock } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  context.createStockMovement(movementInput(productId));

  assert.equal(lock.released, true);
});

test("releases the movement lock after a storage failure", () => {
  const { context, options, lock } = createTestEnvironment();
  const productId = seedMovementProduct(context);

  options.storageFailure = true;

  context.createStockMovement(movementInput(productId));

  assert.equal(lock.released, true);
});
