
/**
 * Returns a consistent validation failure.
 */
function validationError_(message, field) {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: message,
      field: field
    }
  };
}

/**
 * Validates and normalizes product input.
 *
 * reorderLevel must be a finite, non-negative number.
 * Fractional reorder levels are supported.
 */
function validateProductInput(input) {
  if (!input || typeof input !== 'object' ||
      Array.isArray(input)) {
    return validationError_(
      'Product input must be an object.',
      'input'
    );
  }

  if (typeof input.sku !== 'string' ||
      !input.sku.trim()) {
    return validationError_(
      'SKU is required.',
      'sku'
    );
  }

  var sku = input.sku.trim();

  if (sku.length > 64) {
    return validationError_(
      'SKU must be 64 characters or fewer.',
      'sku'
    );
  }

  if (typeof input.name !== 'string' ||
      !input.name.trim()) {
    return validationError_(
      'Product name is required.',
      'name'
    );
  }

  var name = input.name.trim();

  if (name.length > 120) {
    return validationError_(
      'Product name must be 120 characters or fewer.',
      'name'
    );
  }

  if (typeof input.unit !== 'string' ||
      !input.unit.trim()) {
    return validationError_(
      'Unit is required.',
      'unit'
    );
  }

  var unit = input.unit.trim();

  if (unit.length > 32) {
    return validationError_(
      'Unit must be 32 characters or fewer.',
      'unit'
    );
  }

  var description = input.description === undefined
    ? ''
    : input.description;

  if (typeof description !== 'string') {
    return validationError_(
      'Description must be text.',
      'description'
    );
  }

  if (description.length > 1000) {
    return validationError_(
      'Description must be 1000 characters or fewer.',
      'description'
    );
  }

  if (typeof input.reorderLevel !== 'number' ||
      !Number.isFinite(input.reorderLevel) ||
      input.reorderLevel < 0) {
    return validationError_(
      'Reorder level must be a finite, non-negative number.',
      'reorderLevel'
    );
  }

  return {
    ok: true,
    data: {
      sku: sku,
      name: name,
      description: description,
      unit: unit,
      reorderLevel: input.reorderLevel
    }
  };
}

/**
 * Validates a proposed stock movement.
 *
 * Receipt and usage quantities are positive inputs.
 * Adjustments accept positive or negative quantities,
 * but never zero.
 */
function validateMovementInput(input) {
  if (!input || typeof input !== 'object' ||
      Array.isArray(input)) {
    return validationError_(
      'Movement input must be an object.',
      'input'
    );
  }

  if (typeof input.productId !== 'string' ||
      !input.productId.trim()) {
    return validationError_(
      'Product ID is required.',
      'productId'
    );
  }

  var type = input.type;

  if (type !== 'receipt' &&
      type !== 'usage' &&
      type !== 'adjustment') {
    return validationError_(
      'Movement type must be receipt, usage, or adjustment.',
      'type'
    );
  }

  if (typeof input.quantity !== 'number' ||
      !Number.isFinite(input.quantity)) {
    return validationError_(
      'Quantity must be a finite number.',
      'quantity'
    );
  }

  if (type === 'adjustment' && input.quantity === 0) {
    return validationError_(
      'Adjustment quantity cannot be zero.',
      'quantity'
    );
  }

  if (type !== 'adjustment' && input.quantity <= 0) {
    return validationError_(
      'Receipt and usage quantities must be positive.',
      'quantity'
    );
  }

  if (typeof input.reason !== 'string' ||
      !input.reason.trim()) {
    return validationError_(
      'A reason is required.',
      'reason'
    );
  }

  var quantityDelta = input.quantity;

  if (type === 'usage') {
    quantityDelta = -input.quantity;
  }

  return {
    ok: true,
    data: {
      productId: input.productId.trim(),
      type: type,
      quantityDelta: quantityDelta,
      reason: input.reason.trim()
    }
  };
}
