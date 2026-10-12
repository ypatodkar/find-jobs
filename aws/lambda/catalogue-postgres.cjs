const { DIMENSIONS, ARRAYS, normalize, pageInfo, strings, terms, fail, historySummary } = require('./catalogue.cjs');
function builder() {
  const params = [];
  return { params, bind(value) { params.push(value); return `$${params.length}`; } };
}
function where(q, b, skip) {
  const clauses = ['j.active'];
  if (q.scopeFirm) clauses.push(`j.payload->'firms' ? ${b.bind(q.scopeFirm)}`);
  for (const [key, field] of Object.entries(DIMENSIONS)) {
    if (key === skip || !q.selected[key].length) continue;
    const p = b.bind(q.selected[key]);
    const test = ARRAYS.has(field) ? `j.payload->'${field}' ?| ${p}::text[]` :
      `COALESCE(j.payload->>'${field}', '${key === 'sponsorship' ? 'unknown' : ''}') = ANY(${p}::text[])`;
    clauses.push(key === 'notcompany' ? `NOT (${test})` : `(${test})`);
  }
  if (q.query) clauses.push(`strpos(lower(j.title || E'\n' || j.company), lower(${b.bind(q.query)})) > 0`);
  if (q.range) clauses.push(`j.posted_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - (${b.bind(q.range - 1)} * INTERVAL '1 day')`);
  if (q.salary) clauses.push(`j.salary_top >= ${b.bind(q.salary)}`);
  if (q.hideOpened && q.seenIds.length) clauses.push(`NOT (j.job_id = ANY(${b.bind(q.seenIds)}::text[]))`);
  if (q.hideOpenedCompanies && q.seenIds.length) clauses.push(`j.company NOT IN (SELECT company FROM job_catalogue WHERE job_id = ANY(${b.bind(q.seenIds)}::text[]))`);
  return clauses.join(' AND ');
}
function order(sort) {
  return ({ newest: 'posted_at DESC NULLS LAST', oldest: "COALESCE(date_trunc('day', posted_at AT TIME ZONE 'UTC'), TIMESTAMP '1970-01-01'), title",
    salary: 'salary_top DESC, posted_at DESC NULLS LAST', company: 'company, title', title: 'title, company',
    count: 'company_count DESC, posted_at DESC NULLS LAST' }[sort] || 'posted_at DESC NULLS LAST') + ', job_id';
}
class PostgresCatalogue {
  constructor(pool) { this.pool = pool; }
  async search(input) {
    const q = normalize(input); const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await c.query("SET LOCAL statement_timeout = '8s'");
      const b = builder(); const filter = where(q, b);
      const totals = await c.query(`SELECT count(*)::int AS total, count(DISTINCT company)::int AS companies FROM job_catalogue j WHERE ${filter}`, b.params);
      const info = pageInfo(q, totals.rows[0].total, totals.rows[0].companies);
      const meta = await c.query('SELECT metadata FROM catalogue_state WHERE singleton');
      if (!meta.rows.length) throw fail(503, 'The job catalogue is being prepared. Please try again shortly.');
      const page = builder(); const condition = where(q, page);
      const limit = page.bind(info.pageSize); const offset = page.bind((info.page - 1) * info.pageSize);
      let jobs = [], groups = [];
      if (q.view === 'flat') {
        const result = await c.query(`WITH filtered AS (
          SELECT j.*, count(*) OVER (PARTITION BY company) AS company_count FROM job_catalogue j WHERE ${condition}
        ) SELECT payload FROM filtered ORDER BY ${order(q.sort)} LIMIT ${limit} OFFSET ${offset}`, page.params);
        jobs = result.rows.map(r => r.payload);
      } else {
        const groupOrder = { newest: 'newest DESC', oldest: 'oldest', count: 'count DESC',
          salary: '"payMax" DESC', title: '"titleFirst"', company: 'company' }[q.sort] + ', company';
        const result = await c.query(`WITH filtered AS (
          SELECT j.*, count(*) OVER (PARTITION BY company) AS company_count FROM job_catalogue j WHERE ${condition}
        ), numbered AS (
          SELECT *, row_number() OVER (PARTITION BY company ORDER BY ${order(q.sort)}) AS rn FROM filtered
        ), cities AS (
          SELECT company, jsonb_agg(jsonb_build_array(city, n)) AS cities FROM (
            SELECT company, payload->>'city' AS city, count(*)::int AS n FROM filtered GROUP BY company, payload->>'city'
          ) x GROUP BY company
        ), backers AS (
          SELECT company, jsonb_agg(DISTINCT firm) AS firms FROM filtered,
            LATERAL jsonb_array_elements_text(payload->'firms') firm GROUP BY company
        ), grouped AS (
          SELECT company, count(*)::int AS count,
            jsonb_agg(payload ORDER BY rn) FILTER (WHERE rn <= 3) AS jobs,
            COALESCE(extract(epoch FROM max(posted_at)) * 1000, 0)::double precision AS newest,
            COALESCE(extract(epoch FROM min(posted_at)) * 1000, 0)::double precision AS oldest,
            max(salary_top) AS "payMax", min(title) AS "titleFirst"
          FROM numbered GROUP BY company
        ) SELECT grouped.*, cities.cities, COALESCE(backers.firms, '[]'::jsonb) AS firms
          FROM grouped JOIN cities USING (company) LEFT JOIN backers USING (company)
          ORDER BY ${groupOrder} LIMIT ${limit} OFFSET ${offset}`, page.params);
        groups = result.rows.map(r => ({ ...r.jobs[0], ...r }));
      }
      const f = builder();
      const parts = Object.entries(DIMENSIONS).map(([key, field]) => {
        const condition = where(q, f, key);
        const from = ARRAYS.has(field) ? `, LATERAL (SELECT DISTINCT value FROM jsonb_array_elements_text(j.payload->'${field}') v(value)) options` : '';
        const value = ARRAYS.has(field) ? 'options.value' : `COALESCE(j.payload->>'${field}', '${key === 'sponsorship' ? 'unknown' : ''}')`;
        return `SELECT '${key}' AS key, ${value} AS value, count(*)::int AS n FROM job_catalogue j ${from}
          WHERE ${condition} GROUP BY ${value}`;
      });
      const facets = Object.fromEntries(Object.keys(DIMENSIONS).map(k => [k, []]));
      const result = await c.query(parts.join(' UNION ALL '), f.params);
      for (const r of result.rows) if (r.value) facets[r.key].push([r.value, r.n]);
      await c.query('COMMIT');
      return { ...info, jobs, groups, facets, metadata: meta.rows[0].metadata };
    } catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  async get(id) {
    const { rows } = await this.pool.query('SELECT payload, description, description_hash FROM job_catalogue WHERE active AND job_id = $1', [id]);
    return rows[0] ? { ...rows[0].payload, description: rows[0].description, descriptionHash: rows[0].description_hash } : null;
  }
  async history(ids) {
    const { rows } = await this.pool.query('SELECT payload FROM job_catalogue WHERE job_id = ANY($1::text[])', [strings(ids, 5000)]);
    return rows.map(r => historySummary(r.payload));
  }
  // Same contract as MemoryCatalogue.poolFor. No ts_rank here on purpose: the shortlist
  // does its own ranking, and asking Postgres to order a set it is about to re-order
  // would pay for a sort twice.
  async poolFor(input, maxAgeDays, now = Date.now()) {
    const q = normalize(input); const b = builder(); const condition = where(q, b);
    const age = maxAgeDays == null ? ''
      : ` AND posted_at IS NOT NULL AND posted_at >= ${b.bind(new Date(now - maxAgeDays * 86400000).toISOString())}`;
    const { rows } = await this.pool.query(`WITH eligible AS (
      SELECT * FROM job_catalogue WHERE ${condition}
    ), counts AS (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE length(trim(description)) >= 80)::int AS described FROM eligible
    ), picked AS (
      SELECT payload, description, description_hash FROM eligible
      WHERE length(trim(description)) >= 80${age}
    ) SELECT counts.*, COALESCE((SELECT jsonb_agg(to_jsonb(picked)) FROM picked), '[]'::jsonb) AS jobs FROM counts`, b.params);
    const r = rows[0];
    return { total: r.total, described: r.described,
      jobs: r.jobs.map(j => ({ ...j.payload, description: j.description, descriptionHash: j.description_hash })) };
  }

  async candidates(input, resume, limit) {
    const q = normalize(input); const b = builder(); const condition = where(q, b);
    const query = b.bind(terms(resume).join(' OR ')); const take = b.bind(limit);
    const { rows } = await this.pool.query(`WITH eligible AS (
      SELECT j.* FROM job_catalogue j WHERE ${condition}
    ), counts AS (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE length(trim(description)) >= 80)::int AS described FROM eligible
    ), ranked AS (
      SELECT payload, description, description_hash FROM eligible
      WHERE length(trim(description)) >= 80
      ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) DESC,
        posted_at DESC NULLS LAST, job_id LIMIT ${take}
    ) SELECT counts.*, COALESCE((SELECT jsonb_agg(to_jsonb(ranked)) FROM ranked), '[]'::jsonb) AS candidates FROM counts`, b.params);
    const r = rows[0];
    return { total: r.total, described: r.described, jobs: r.candidates.map(j => ({ ...j.payload,
      description: j.description, descriptionHash: j.description_hash })) };
  }
  async cacheGet(key) {
    return (await this.pool.query('SELECT result FROM resume_match_cache WHERE cache_key=$1 AND expires_at > NOW()', [key])).rows[0]?.result || null;
  }
  async cacheSet(key, value) {
    await this.pool.query(`INSERT INTO resume_match_cache VALUES ($1,$2,NOW()+INTERVAL '1 day')
      ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result, expires_at=EXCLUDED.expires_at`, [key, value]);
  }
  async quota(key, limit, windowMs, amount = 1) {
    if (amount > limit) return false;
    const bucket = Math.floor(Date.now() / windowMs);
    const { rows } = await this.pool.query(`INSERT INTO match_quota VALUES ($1,$2,$3,$4)
      ON CONFLICT (quota_key,bucket) DO UPDATE SET uses=match_quota.uses+EXCLUDED.uses
      WHERE match_quota.uses+EXCLUDED.uses <= $5 RETURNING uses`,
    [key, bucket, amount, new Date((bucket + 1) * windowMs), limit]);
    return amount <= limit && rows.length > 0;
  }
}
module.exports = { PostgresCatalogue, where, builder };
