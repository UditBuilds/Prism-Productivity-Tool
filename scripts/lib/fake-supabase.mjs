/**
 * An in-memory stand-in for the slice of the supabase-js query builder the
 * planner and the Telegram bot use: select / update / upsert / insert with
 * eq, neq, is, lt, lte, gt, gte, in, order, limit, maybeSingle, single.
 *
 * NOT Postgres. It exists so unit tests can prove WHICH rows a code path
 * writes and that a second run writes nothing new. Comparison rules follow
 * SQL where it matters here: a NULL never matches neq / lt / gt, and
 * timestamps compare as instants.
 *
 * Every write is appended to `log`, and `failOn(table, op)` makes the next
 * matching call return an error, for retry-after-failure tests.
 */

function cmp(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (typeof a === "string" && typeof b === "string") {
    const isTs = (s) => /^\d{4}-\d{2}-\d{2}T/.test(s);
    if (isTs(a) && isTs(b)) return Date.parse(a) - Date.parse(b);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function project(row, cols) {
  if (!cols || cols.trim() === "*") return { ...row };
  const out = {};
  for (const c of cols.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = row[c];
  return out;
}

export function createFakeSupabase(seed = {}, { defaults = {}, uniques = {}, user = null } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const log = [];
  const failures = [];
  let calls = 0;
  const table = (name) => (tables[name] ??= []);

  class Query {
    constructor(name) {
      this.name = name;
      this.op = null;
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.single = null;
      this.returning = null;
    }
    select(cols = "*") {
      if (this.op) this.returning = cols;
      else {
        this.op = "select";
        this.cols = cols;
      }
      return this;
    }
    update(values) {
      this.op = "update";
      this.values = values;
      return this;
    }
    upsert(rows, opts = {}) {
      this.op = "upsert";
      this.rows = Array.isArray(rows) ? rows : [rows];
      this.opts = opts;
      return this;
    }
    insert(rows) {
      this.op = "insert";
      this.rows = Array.isArray(rows) ? rows : [rows];
      this.opts = {};
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(c, v) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    neq(c, v) {
      this.filters.push((r) => r[c] !== null && r[c] !== undefined && r[c] !== v);
      return this;
    }
    is(c, v) {
      this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v));
      return this;
    }
    lt(c, v) {
      this.filters.push((r) => (cmp(r[c], v) ?? 0) < 0 && cmp(r[c], v) !== null);
      return this;
    }
    lte(c, v) {
      this.filters.push((r) => cmp(r[c], v) !== null && cmp(r[c], v) <= 0);
      return this;
    }
    gt(c, v) {
      this.filters.push((r) => cmp(r[c], v) !== null && cmp(r[c], v) > 0);
      return this;
    }
    gte(c, v) {
      this.filters.push((r) => cmp(r[c], v) !== null && cmp(r[c], v) >= 0);
      return this;
    }
    in(c, vs) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    not(c, op, v) {
      if (op === "is" && v === null) this.filters.push((r) => r[c] !== null && r[c] !== undefined);
      else throw new Error(`fake-supabase: not(${op}) unsupported`);
      return this;
    }
    order(c, { ascending = true, nullsFirst } = {}) {
      this.orders.push({ c, ascending, nullsFirst: nullsFirst ?? !ascending });
      return this;
    }
    limit(n) {
      this.limitN = n;
      return this;
    }
    maybeSingle() {
      this.single = "maybe";
      return this;
    }
    then(resolve, reject) {
      return Promise.resolve()
        .then(() => this.exec())
        .then(resolve, reject);
    }
    matches(r) {
      return this.filters.every((f) => f(r));
    }
    exec() {
      calls += 1;
      const fi = failures.findIndex((f) => f.table === this.name && f.op === this.op);
      if (fi >= 0) {
        const [f] = failures.splice(fi, 1);
        return { data: null, error: { message: f.message, code: "FAKE" } };
      }
      const rows = table(this.name);

      if (this.op === "select") {
        let out = rows.filter((r) => this.matches(r));
        for (const o of [...this.orders].reverse()) {
          out = [...out].sort((a, b) => {
            const an = a[o.c] === null || a[o.c] === undefined;
            const bn = b[o.c] === null || b[o.c] === undefined;
            if (an || bn) return an === bn ? 0 : an === o.nullsFirst ? -1 : 1;
            const d = cmp(a[o.c], b[o.c]);
            return o.ascending ? d : -d;
          });
        }
        if (this.limitN !== null) out = out.slice(0, this.limitN);
        out = out.map((r) => project(r, this.cols));
        if (this.single === "maybe") {
          if (out.length > 1) return { data: null, error: { message: "multiple rows" } };
          return { data: out[0] ?? null, error: null };
        }
        return { data: out, error: null };
      }

      if (this.op === "update") {
        const hit = rows.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, this.values);
        log.push({ table: this.name, op: "update", values: { ...this.values }, ids: hit.map((r) => r.id) });
        return { data: this.returning ? hit.map((r) => project(r, this.returning)) : null, error: null };
      }

      if (this.op === "upsert" || this.op === "insert") {
        const conflictCols = (this.opts.onConflict ?? "id").split(",").map((s) => s.trim());
        const written = [];
        for (const raw of this.rows) {
          const full = { ...(defaults[this.name]?.() ?? {}), ...raw };
          if (full.id === undefined) full.id = `gen-${rows.length + 1}`;
          const clash = rows.find(
            (r) =>
              conflictCols.every((c) => r[c] === full[c]) ||
              r.id === full.id ||
              (uniques[this.name] ?? []).some((cols) => cols.every((c) => r[c] === full[c]))
          );
          if (clash) {
            if (this.op === "insert") {
              return { data: null, error: { message: "duplicate key", code: "23505" } };
            }
            if (this.opts.ignoreDuplicates) continue;
            Object.assign(clash, raw);
            written.push(clash);
            continue;
          }
          rows.push(full);
          written.push(full);
        }
        log.push({ table: this.name, op: this.op, rows: written.map((r) => ({ ...r })) });
        return { data: this.returning ? written.map((r) => project(r, this.returning)) : null, error: null };
      }

      if (this.op === "delete") {
        const keep = rows.filter((r) => !this.matches(r));
        const removed = rows.length - keep.length;
        tables[this.name] = keep;
        log.push({ table: this.name, op: "delete", count: removed });
        return { data: null, error: null };
      }

      throw new Error(`fake-supabase: no operation on ${this.name}`);
    }
  }

  return {
    from: (name) => new Query(name),
    rpc: () => {
      throw new Error("fake-supabase: rpc not supported");
    },
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    tables,
    log,
    get calls() {
      return calls;
    },
    failOn(tableName, op, message = "injected failure") {
      failures.push({ table: tableName, op, message });
    },
  };
}
