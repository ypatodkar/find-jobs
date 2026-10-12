const { entries, fail } = require('./catalogue.cjs');
async function importCatalogue(pool, data, metadata) {
  const records = entries(data);
  if (!records.length || !Number.isFinite(Date.parse(data.scrapedAt))) throw fail(400, 'Refusing an empty or undated catalogue.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('find-jobs-catalogue-import'))");
    const previous = (await c.query('SELECT metadata FROM catalogue_state WHERE singleton')).rows[0]?.metadata;
    if (previous && Date.parse(previous.scrapedAt) > Date.parse(data.scrapedAt)) throw fail(409, 'Refusing an older catalogue.');
    await c.query(`CREATE TEMP TABLE incoming_catalogue (job_id TEXT PRIMARY KEY, payload JSONB, description TEXT,
      description_hash TEXT, content_hash TEXT) ON COMMIT DROP`);
    for (let i = 0; i < records.length; i += 100) {
      await c.query(`INSERT INTO incoming_catalogue SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS r(job_id TEXT, payload JSONB, description TEXT, description_hash TEXT, content_hash TEXT)`, [JSON.stringify(records.slice(i, i + 100))]);
    }
    const changed = await c.query(`INSERT INTO job_catalogue
      (job_id,payload,company,title,posted_at,salary_top,description,description_hash,content_hash)
      SELECT job_id,payload,payload->>'company',payload->>'title',(payload->>'posted')::timestamptz,
        COALESCE(NULLIF((payload->>'salaryMax')::float,0), (payload->>'salaryMin')::float,0),description,description_hash,content_hash
      FROM incoming_catalogue
      ON CONFLICT(job_id) DO UPDATE SET payload=EXCLUDED.payload, company=EXCLUDED.company, title=EXCLUDED.title,
        posted_at=EXCLUDED.posted_at, salary_top=EXCLUDED.salary_top, description=EXCLUDED.description,
        description_hash=EXCLUDED.description_hash, content_hash=EXCLUDED.content_hash, active=TRUE, updated_at=NOW()
      WHERE job_catalogue.content_hash IS DISTINCT FROM EXCLUDED.content_hash OR NOT job_catalogue.active`);
    // A failed upstream must not close jobs that merely went unobserved this run.
    const goodFirms = Object.entries(metadata.firms || {}).filter(([,r]) => r.status === 'ok').map(([id]) => id);
    const failedCompanies = (metadata.failures || []).map(r => r.company);
    const retired = await c.query(`UPDATE job_catalogue j SET active=FALSE, updated_at=NOW()
      WHERE active AND NOT EXISTS (SELECT 1 FROM incoming_catalogue i WHERE i.job_id=j.job_id)
        AND j.payload->'firms' ?| $1::text[] AND NOT (j.company = ANY($2::text[]))
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(j.payload->'firms') f
          WHERE NOT (f = ANY($1::text[])))`, [goodFirms, failedCompanies]);
    const summary = (await c.query('SELECT count(*)::int AS total, count(DISTINCT company)::int AS companies FROM job_catalogue WHERE active')).rows[0];
    await c.query(`INSERT INTO catalogue_state VALUES (TRUE,$1) ON CONFLICT(singleton) DO UPDATE SET metadata=EXCLUDED.metadata`,
      [{ ...metadata, summary, scrapedAt: data.scrapedAt }]);
    await c.query('DELETE FROM resume_match_cache WHERE expires_at < NOW()');
    await c.query('DELETE FROM match_quota WHERE expires_at < NOW()');
    await c.query('COMMIT');
    return { jobs: records.length, changed: changed.rowCount, retired: retired.rowCount };
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
module.exports = { importCatalogue };
