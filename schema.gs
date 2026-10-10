
var STOCKROOM_SCHEMA = {
  Products: [
    'productId',
    'sku',
    'name',
    'description',
    'unit',
    'reorderLevel',
    'isArchived',
    'createdAt',
    'updatedAt'
  ],

  StockMovements: [
    'movementId',
    'productId',
    'type',
    'quantityDelta',
    'reason',
    'createdAt',
    'actor',
    'requestId'
  ],

  AuditLog: [
    'auditId',
    'timestamp',
    'actor',
    'action',
    'entityType',
    'entityId',
    'details',
    'requestId'
  ]
};
