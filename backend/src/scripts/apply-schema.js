require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'a1tv',
  user: process.env.DB_USER || 'a1tv',
  password: process.env.DB_PASSWORD || 'a1tv_secret',
  max: 2,
});

function splitSql(sql) {
  const stmts = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      const end = sql.indexOf('$$', i + 2);
      if (end === -1) {
        current += sql.slice(i);
        break;
      }
      current += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (sql[i] === ';') {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = '';
    } else {
      current += sql[i];
    }
    i++;
  }
  const last = current.trim();
  if (last) stmts.push(last);
  return stmts;
}

async function main() {
  const schemaPath = path.join(__dirname, '..', '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSql(sql);
  const client = await pool.connect();
  try {
    let ok = 0, fail = 0, skip = 0;
    for (const stmt of statements) {
      if (!stmt || stmt.length < 3) continue;
      try {
        await client.query(stmt);
        ok++;
      } catch (err) {
        const msg = (err && err.message) || String(err);
        if (/already exists|duplicate key|already/i.test(msg)) {
          skip++;
        } else if (/must be marked IMMUTABLE|unterminated dollar-quoted|syntax error at or near "NOT"/i.test(msg)) {
          fail++;
          console.error('FAIL:', msg.slice(0, 160));
          console.error('  SQL:', stmt.replace(/\s+/g, ' ').slice(0, 100));
        } else {
          fail++;
          console.error('FAIL:', msg.slice(0, 160));
          console.error('  SQL:', stmt.replace(/\s+/g, ' ').slice(0, 100));
        }
      }
    }
    console.log(`Schema applied: ${ok} ok, ${skip} skipped, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('DB bootstrap failed:', err);
  process.exit(1);
});
