
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'validation.gs'),
  'utf8'
);

const appScriptContext = {};
vm.runInNewContext(source, appScriptContext);

const { validateProductInput, validateMovementInput } =
  appScriptContext;

test('accepts a product with a fractional reorder level', () => {
  const result = validateProductInput({
    sku: '  bolt-01 ',
    name: ' Hex Bolt ',
    unit: 'each',
    reorderLevel: 2.5
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.sku, 'bolt-01');
  assert.equal(result.data.name, 'Hex Bolt');
  assert.equal(result.data.reorderLevel, 2.5);
  assert.equal(result.data.description, '');
});

test('rejects a missing SKU', () => {
  const result = validateProductInput({
    name: 'Hex Bolt',
    unit: 'each',
    reorderLevel: 2
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.equal(result.error.field, 'sku');
});

test('rejects a negative reorder level', () => {
  const result = validateProductInput({
    sku: 'BOLT-01',
    name: 'Hex Bolt',
    unit: 'each',
    reorderLevel: -1
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'reorderLevel');
});

test('rejects a non-finite reorder level', () => {
  const result = validateProductInput({
    sku: 'BOLT-01',
    name: 'Hex Bolt',
    unit: 'each',
    reorderLevel: Infinity
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'reorderLevel');
});

test('converts usage quantity into a negative delta', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'usage',
    quantity: 1.25,
    reason: 'Used for repair'
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.quantityDelta, -1.25);
});

test('accepts a negative fractional adjustment', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'adjustment',
    quantity: -0.5,
    reason: 'Stock count correction'
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.quantityDelta, -0.5);
});

test('rejects zero adjustments', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'adjustment',
    quantity: 0,
    reason: 'Correction'
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'quantity');
});

test('rejects negative receipt quantities', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'receipt',
    quantity: -2,
    reason: 'Delivery'
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'quantity');
});

test('rejects unsupported movement types', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'transfer',
    quantity: 1,
    reason: 'Transfer'
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'type');
});

test('rejects missing movement reasons', () => {
  const result = validateMovementInput({
    productId: 'product-1',
    type: 'receipt',
    quantity: 3
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.field, 'reason');
});
