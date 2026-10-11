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
        return "test-product-id";
      },
    },
  };

  vm.createContext(context);

  for (const file of ["schema.gs", "validation.gs", "products.gs"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");

    vm.runInContext(source, context, { filename: file });
  }

  // Provide the configured spreadsheet directly for the tests.

  context.getStockroomSpreadsheet_ = () => {
    if (options.storageFailure) {
      throw new Error("Simulated storage failure");
    }

    return spreadsheet;
  };

  // Initialize the Products sheet with the real schema.
  const productsSheet = new FakeSheet();
  productsSheet.rows.push(context.STOCKROOM_SCHEMA.Products);
  sheets.Products = productsSheet;

  return { context, productsSheet, lock };
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

test("creates a product with generated ID and timestamps", () => {
  const { context, productsSheet } = createTestEnvironment();

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, true);
  assert.equal(result.data.productId, "test-product-id");
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

  const duplicate = context.createProduct(validProduct({ sku: "part-001" }));

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "DUPLICATE_SKU");
  assert.equal(productsSheet.getLastRow(), 2);
});

test("does not write invalid product input", () => {
  const { context, productsSheet, lock } = createTestEnvironment();

  const result = context.createProduct(validProduct({ name: "  " }));

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

test("releases the lock after a successful create", () => {
  const { context, lock } = createTestEnvironment();

  context.createProduct(validProduct());

  assert.equal(lock.released, true);
});

test("returns a controlled error when the lock is unavailable", () => {
  const { context, productsSheet, lock } = createTestEnvironment({
    lockAvailable: false,
  });

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SERVICE_BUSY");
  assert.equal(productsSheet.getLastRow(), 1);
  assert.equal(lock.released, false);
});

test("returns a controlled error when storage fails", () => {
  const { context } = createTestEnvironment({
    storageFailure: true,
  });

  const result = context.createProduct(validProduct());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "STORAGE_ERROR");
});
