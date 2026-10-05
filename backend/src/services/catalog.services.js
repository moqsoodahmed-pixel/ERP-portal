import { NotFoundError } from '../utils/errors.js';
import { AUDIT_ACTIONS, PRODUCT_STATUS, CUSTOMER_STATUS } from '../constants/statuses.js';
import { ID_PREFIX } from '../constants/pagination.js';
import { formatCode } from '../utils/codes.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

const listArgs = (query, sortable) => {
  const p = parsePagination(query);
  return {
    p,
    args: {
      ...p, search: query.search, sort: parseSort(query.sort, sortable),
      filter: query.status ? { status: query.status } : {}, dateRange: { from: query.from, to: query.to },
    },
  };
};

export class ProductService {
  constructor({ productRepo, counterRepo, auditService }) { Object.assign(this, { productRepo, counterRepo, auditService }); }

  async list(ctx, query) {
    const { p, args } = listArgs(query, ['productName', 'productCode', 'sellingPrice', 'createdAt']);
    const r = await this.productRepo.findPage(ctx.tenantId, args);
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async get(ctx, id) {
    const product = await this.productRepo.findOneById(ctx.tenantId, id);
    if (!product) throw new NotFoundError('Product not found');
    return product;
  }

  async create(ctx, dto) {
    const productCode = formatCode(ID_PREFIX.product, await this.counterRepo.next(ctx.tenantId, 'product'));
    const product = await this.productRepo.create(ctx.tenantId, { ...dto, productCode, status: PRODUCT_STATUS.ACTIVE }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.PRODUCT_CREATED, resourceType: 'Product', resourceId: product._id, metadata: { productCode } });
    return product;
  }

  async update(ctx, id, patch) {
    const product = await this.productRepo.updateById(ctx.tenantId, id, patch, ctx.actor.id);
    if (!product) throw new NotFoundError('Product not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.PRODUCT_UPDATED, resourceType: 'Product', resourceId: id, metadata: { fields: Object.keys(patch) } });
    return product;
  }

  /** Archive, never physically delete: invoices keep referencing the product code/snapshot. */
  async archive(ctx, id) {
    const product = await this.productRepo.softDeleteById(ctx.tenantId, id, ctx.actor.id, { status: PRODUCT_STATUS.ARCHIVED });
    if (!product) throw new NotFoundError('Product not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.PRODUCT_ARCHIVED, resourceType: 'Product', resourceId: id, metadata: { previous: 'ACTIVE', next: 'ARCHIVED' } });
    return product;
  }
}

export class CustomerService {
  constructor({ customerRepo, counterRepo, auditService }) { Object.assign(this, { customerRepo, counterRepo, auditService }); }

  async list(ctx, query) {
    const { p, args } = listArgs(query, ['name', 'customerCode', 'createdAt']);
    const r = await this.customerRepo.findPage(ctx.tenantId, args);
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async get(ctx, id) {
    const customer = await this.customerRepo.findOneById(ctx.tenantId, id);
    if (!customer) throw new NotFoundError('Customer not found');
    return customer;
  }

  async create(ctx, dto) {
    const customerCode = formatCode(ID_PREFIX.customer, await this.counterRepo.next(ctx.tenantId, 'customer'));
    const customer = await this.customerRepo.create(ctx.tenantId, { ...dto, customerCode, status: CUSTOMER_STATUS.ACTIVE }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.CUSTOMER_CREATED, resourceType: 'Customer', resourceId: customer._id, metadata: { customerCode } });
    return customer;
  }

  async update(ctx, id, patch) {
    const customer = await this.customerRepo.updateById(ctx.tenantId, id, patch, ctx.actor.id);
    if (!customer) throw new NotFoundError('Customer not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.CUSTOMER_UPDATED, resourceType: 'Customer', resourceId: id, metadata: { fields: Object.keys(patch) } });
    return customer;
  }

  async archive(ctx, id) {
    const customer = await this.customerRepo.softDeleteById(ctx.tenantId, id, ctx.actor.id, { status: CUSTOMER_STATUS.ARCHIVED });
    if (!customer) throw new NotFoundError('Customer not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.CUSTOMER_ARCHIVED, resourceType: 'Customer', resourceId: id });
    return customer;
  }
}
