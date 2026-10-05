import crypto from 'node:crypto';

const oid = () => crypto.randomBytes(12).toString('hex');
const clone = (v) => (v === undefined ? v : structuredClone(v));
const isOps = (c) => c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c) && Object.keys(c).some((k) => k.startsWith('$'));

function eq(a, b) {
  if (b === null || b === undefined) return a === null || a === undefined;
  if (a === null || a === undefined) return false;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
}
const cmp = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() - new Date(b).getTime() : Number(a) - Number(b));

function matchValue(val, cond) {
  if (!isOps(cond)) return Array.isArray(val) ? val.some((x) => eq(x, cond)) : eq(val, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in': return arg.some((x) => (Array.isArray(val) ? val.some((y) => eq(y, x)) : eq(val, x)));
      case '$nin': return !arg.some((x) => eq(val, x));
      case '$ne': return !eq(val, arg);
      case '$eq': return eq(val, arg);
      case '$gte': return val !== undefined && cmp(val, arg) >= 0;
      case '$lte': return val !== undefined && cmp(val, arg) <= 0;
      case '$gt': return val !== undefined && cmp(val, arg) > 0;
      case '$lt': return val !== undefined && cmp(val, arg) < 0;
      case '$exists': return (val !== undefined) === arg;
      case '$regex': return new RegExp(arg, cond.$options ?? '').test(String(val ?? ''));
      case '$options': return true;
      default: throw new Error(`FakeModel: unsupported operator ${op}`);
    }
  });
}

export function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => matches(doc, f));
    if (k === '$and') return cond.every((f) => matches(doc, f));
    if (k.startsWith('$')) throw new Error(`FakeModel: unsupported top-level operator ${k}`);
    return matchValue(doc[k], cond);
  });
}

class Query {
  constructor(exec) { this.exec = exec; this.opts = {}; }
  sort(s) { this.opts.sort = s; return this; }
  skip(n) { this.opts.skip = n; return this; }
  limit(n) { this.opts.limit = n; return this; }
  select() { return this; }
  lean() { return this; }
  then(res, rej) { return Promise.resolve().then(() => this.exec(this.opts)).then(res, rej); }
}

/** Minimal in-memory stand-in for a Mongoose model. Strictly rejects unsupported operators so tests can't silently pass. */
export class FakeModel {
  constructor(name, { unique = [] } = {}) { this.name = name; this.unique = unique; this.docs = []; }

  #checkUnique(candidate, ignoreId) {
    for (const keys of this.unique) {
      if (keys.some((k) => candidate[k] === undefined || candidate[k] === null)) continue;
      const dup = this.docs.find((d) => d._id !== ignoreId && keys.every((k) => eq(d[k], candidate[k])));
      if (dup) { const e = new Error(`E11000 duplicate key (${keys.join(',')})`); e.code = 11000; throw e; }
    }
  }

  async create(data) {
    const doc = { ...clone(data), _id: data._id ?? oid(), createdAt: new Date(), updatedAt: new Date() };
    for (const k of Object.keys(doc)) if (doc[k] && doc[k]._bsontype) doc[k] = String(doc[k]);
    this.#checkUnique(doc);
    this.docs.push(doc);
    return clone(doc);
  }

  find(filter = {}) {
    return new Query((o) => {
      let out = this.docs.filter((d) => matches(d, filter));
      if (o.sort) {
        const entries = Object.entries(o.sort);
        out = [...out].sort((a, b) => { for (const [k, dir] of entries) { const c = cmp(a[k] ?? 0, b[k] ?? 0); if (c) return c * dir; } return 0; });
      }
      if (o.skip) out = out.slice(o.skip);
      if (o.limit) out = out.slice(0, o.limit);
      return out.map(clone);
    });
  }

  findOne(filter = {}) { return new Query(() => clone(this.docs.find((d) => matches(d, filter))) ?? null); }
  countDocuments(filter = {}) { return new Query(() => this.docs.filter((d) => matches(d, filter)).length); }

  #apply(doc, update, { isInsert = false } = {}) {
    for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = clone(v);
    if (isInsert) for (const [k, v] of Object.entries(update.$setOnInsert ?? {})) doc[k] = clone(v);
    for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
    for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
    doc.updatedAt = new Date();
  }

  findOneAndUpdate(filter, update, opts = {}) {
    return new Query(() => {
      let doc = this.docs.find((d) => matches(d, filter));
      const before = clone(doc);
      let isInsert = false;
      if (!doc && opts.upsert) {
        isInsert = true;
        const base = Object.fromEntries(Object.entries(filter).filter(([, v]) => !isOps(v)));
        doc = {
          _id: (update.$setOnInsert?._id ?? update.$set?._id) ?? oid(), ...base, createdAt: new Date(),
        };
        this.#checkUnique(doc, doc._id);
        this.docs.push(doc);
      }
      if (!doc) return null;
      this.#apply(doc, update, { isInsert });
      const wantsAfter = opts.new || opts.returnDocument === 'after';
      return clone(wantsAfter ? doc : before);
    });
  }

  async updateMany(filter, update) {
    const hit = this.docs.filter((d) => matches(d, filter));
    hit.forEach((d) => this.#apply(d, update));
    return { modifiedCount: hit.length };
  }

  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  /**
   * Minimal aggregation-pipeline emulation (Phase 9). Supports ONLY the stages/expressions the report and
   * dashboard pipelines use; anything else throws so a test can never silently pass on an unsupported
   * pipeline. Real-MongoDB behaviour of the same pipelines is verified in tests/integration/phase9.mongo.test.js.
   */
  aggregate(pipeline) {
    return new Query(() => runPipeline(this, pipeline).map(clone));
  }
}

/** Set by the harness so `$lookup` can resolve sibling fake collections by model or collection name. */
FakeModel.registry = {};

const getPath = (doc, path) => path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), doc);
const truthy = (v) => !(v === false || v === null || v === undefined || v === 0);
const isDecimalLike = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);

function evalExpr(doc, expr) {
  if (typeof expr === 'string' && expr.startsWith('$')) return getPath(doc, expr.slice(1));
  if (expr === null || typeof expr !== 'object' || expr instanceof Date || Array.isArray(expr)) return expr;
  const [op, arg] = Object.entries(expr)[0];
  switch (op) {
    case '$cond': return truthy(evalExpr(doc, arg[0])) ? evalExpr(doc, arg[1]) : evalExpr(doc, arg[2]);
    case '$ifNull': { const v = evalExpr(doc, arg[0]); return v === null || v === undefined ? evalExpr(doc, arg[1]) : v; }
    case '$eq': return eq(evalExpr(doc, arg[0]), evalExpr(doc, arg[1]));
    case '$in': { const v = evalExpr(doc, arg[0]); return evalExpr(doc, arg[1]).some((x) => eq(v, x)); }
    case '$dateToString': {
      const d = evalExpr(doc, arg.date);
      if (!d) return null;
      const iso = new Date(d).toISOString();
      if (arg.format === '%Y-%m') return iso.slice(0, 7);
      if (arg.format === '%Y-%m-%d') return iso.slice(0, 10);
      throw new Error(`FakeModel: unsupported $dateToString format ${arg.format}`);
    }
    default: throw new Error(`FakeModel: unsupported expression ${op}`);
  }
}

function accumulate(op, values) {
  switch (op) {
    case '$sum': {
      const nums = values.filter((v) => v !== null && v !== undefined && (typeof v === 'number' || isDecimalLike(String(v))));
      if (nums.some((v) => typeof v !== 'number')) {
        // Money is Decimal128 in MongoDB; the fake stores exact decimal strings. Sum exactly (scaled integers).
        const scale = 4;
        const total = nums.reduce((s, v) => s + BigInt(Math.round(Number(v) * 10 ** scale)), 0n);
        const neg = total < 0n; const abs = neg ? -total : total;
        const str = abs.toString().padStart(scale + 1, '0');
        return `${neg ? '-' : ''}${str.slice(0, -scale)}.${str.slice(-scale)}`;
      }
      return nums.reduce((s, v) => s + v, 0);
    }
    case '$max': return values.filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === null || cmp(v, m) > 0 ? v : m), null);
    case '$min': return values.filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === null || cmp(v, m) < 0 ? v : m), null);
    case '$first': return values.length ? values[0] : null;
    default: throw new Error(`FakeModel: unsupported accumulator ${op}`);
  }
}

function runPipeline(model, pipeline) {
  let rows = model.docs.map(clone);
  for (const stage of pipeline) {
    const [name, spec] = Object.entries(stage)[0];
    switch (name) {
      case '$match': rows = rows.filter((d) => matches(d, spec)); break;
      case '$sort': {
        const entries = Object.entries(spec);
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of entries) {
            const av = getPath(a, k); const bv = getPath(b, k);
            const c = typeof av === 'string' || typeof bv === 'string' ? String(av ?? '').localeCompare(String(bv ?? '')) : cmp(av ?? 0, bv ?? 0);
            if (c) return c * dir;
          }
          return 0;
        });
        break;
      }
      case '$skip': rows = rows.slice(spec); break;
      case '$limit': rows = rows.slice(0, spec); break;
      case '$count': rows = rows.length ? [{ [spec]: rows.length }] : []; break;
      case '$unwind': {
        const path = (typeof spec === 'string' ? spec : spec.path).slice(1);
        const keep = typeof spec === 'object' && spec.preserveNullAndEmptyArrays;
        rows = rows.flatMap((d) => {
          const v = getPath(d, path);
          if (Array.isArray(v) && v.length) return v.map((x) => ({ ...d, [path]: x }));
          if (keep) { const { [path]: _omit, ...rest } = d; return [rest]; }
          return [];
        });
        break;
      }
      case '$lookup': {
        const other = Object.values(FakeModel.registry).find((m) => m.name === spec.from || `${m.name.toLowerCase()}s` === spec.from);
        if (!other || !spec.localField || !spec.foreignField || spec.pipeline) throw new Error('FakeModel: unsupported $lookup');
        rows = rows.map((d) => ({ ...d, [spec.as]: other.docs.filter((o) => eq(getPath(o, spec.foreignField), getPath(d, spec.localField))).map(clone) }));
        break;
      }
      case '$group': {
        const groups = new Map();
        for (const d of rows) {
          const idVal = spec._id === null ? null
            : (typeof spec._id === 'object' && !spec._id.$cond && !spec._id.$dateToString && !spec._id.$ifNull
              ? Object.fromEntries(Object.entries(spec._id).map(([k, e]) => [k, evalExpr(d, e)]))
              : evalExpr(d, spec._id));
          const key = JSON.stringify(idVal ?? null);
          if (!groups.has(key)) groups.set(key, { _id: idVal ?? null, docs: [] });
          groups.get(key).docs.push(d);
        }
        rows = [...groups.values()].map(({ _id, docs }) => {
          const out = { _id };
          for (const [field, acc] of Object.entries(spec)) {
            if (field === '_id') continue;
            const [op, e] = Object.entries(acc)[0];
            out[field] = accumulate(op, docs.map((d) => evalExpr(d, e)));
          }
          return out;
        });
        break;
      }
      default: throw new Error(`FakeModel: unsupported pipeline stage ${name}`);
    }
  }
  return rows;
}
