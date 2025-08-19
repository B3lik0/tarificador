#!/usr/bin/env node
/**
 * Genera un archivo sql.txt con un INSERT INTO multi-valor a partir del CSV más reciente
 * y además inserta esas filas en MySQL automáticamente.
 * Características:
 *  - Detección automática del .csv más reciente en ./files (prioriza archivos de HOY, si no hay, toma el más reciente).
 *  - Ignora la primera línea (cabecera).
 *  - Mapea columnas al INSERT de la tabla cdr_avaya.tarificador.
 * Requisitos: npm i csv-parse mysql2
 * Uso: node excel_a_sql.js
 * Variables de entorno: DB_HOST, DB_USER, DB_PASSWORD, DB_PORT (opcional, 3306 por defecto)
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DEFAULT_DIR = 'files';
const DEFAULT_OUTPUT = 'sql.txt';
const DEFAULT_DELIM = ',';
const DEFAULT_DB = { database: 'cdr_avaya', table: 'tarificador' };
const COLUMNS = process.env.DB_COLUMNS ? process.env.DB_COLUMNS.split(',') : [];

function parseArgs() {
  return { dir: DEFAULT_DIR, output: DEFAULT_OUTPUT, delim: DEFAULT_DELIM };
}

function sqlEscape(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (val instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = val.getFullYear();
    const m = pad(val.getMonth() + 1);
    const d = pad(val.getDate());
    const hh = pad(val.getHours());
    const mm = pad(val.getMinutes());
    const ss = pad(val.getSeconds());
    return `'${y}-${m}-${d} ${hh}:${mm}:${ss}'`;
  }
  const s = String(val);
  const escaped = s.replace(/'/g, "''");
  return `'${escaped}'`;
}

function findLatestCsv(dir) {
  const absDir = path.resolve(process.cwd(), dir);
  const entries = fs.readdirSync(absDir)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .map(f => {
      const full = path.join(absDir, f);
      const st = fs.statSync(full);
      return { file: full, mtime: st.mtime, date: st.mtime };
    });
  if (entries.length === 0) return null;

  // Priorizar archivos de HOY
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const isToday = (dt) => dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;

  const todays = entries.filter(e => isToday(e.mtime));
  const list = (todays.length ? todays : entries).sort((a, b) => b.mtime - a.mtime);
  return list[0].file;
}


async function insertarEnMySQL(rows) {
  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const port = Number(process.env.DB_PORT || 3306);
  const { database, table } = DEFAULT_DB;

  const conn = await mysql.createConnection({ host, user, password, port, database, multipleStatements: false });
  try {
    const batchSize = 1000;
    const placeholders = `(${COLUMNS.map(() => '?').join(',')})`;
    let total = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const flat = slice.flat();
      const valuesClause = Array(slice.length).fill(placeholders).join(',');
      const stmt = `INSERT INTO ${table} (${COLUMNS.join(',')}) VALUES ${valuesClause}`;
      await conn.execute(stmt, flat);
      total += slice.length;
    }
    return total;
  } finally {
    await conn.end();
  }
}

async function main() {
  const { dir, output, delim } = parseArgs();
  const latestCsv = findLatestCsv(dir);
  if (!latestCsv) {
    console.error(`No se encontró ningún .csv en: ${path.resolve(process.cwd(), dir)}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(latestCsv, 'utf8');
  const records = parse(csvContent, {
    delimiter: delim,
    columns: false,
    bom: true,
    skip_empty_lines: true,
    from_line: 2
  });

  if (records.length === 0) {
    console.error('El CSV no contiene filas de datos.');
    process.exit(1);
  }

  // Asumimos que el CSV viene en el mismo orden de columnas que COLUMNS
  // Transformar cada registro en un array ordenado para prepared statements
  let orderedRows = records.map((arr) => COLUMNS.map((_, idx) => {
    const v = arr[idx];
    if (v === undefined || v === null || v === '') return null;
    return v;
  }));



  // 1) Generar archivo SQL siempre
  const values = orderedRows.map((ordered) => `(${ordered.map(sqlEscape).join(', ')})`);
  const headerCols = COLUMNS.join(', ');
  const sql = `INSERT INTO cdr_avaya.tarificador (\n    ${headerCols}\n)\nVALUES\n${values.join(',\n')}\n;\n`;
  fs.writeFileSync(path.resolve(process.cwd(), output), sql, 'utf8');
  console.log(`Generado ${output} desde: ${path.basename(latestCsv)} con ${orderedRows.length} filas.`);

  // 2) Insertar en la base de datos
  try {
    const inserted = await insertarEnMySQL(orderedRows);
    console.log(`Insertadas ${inserted} filas en ${DEFAULT_DB.database}.${DEFAULT_DB.table} desde: ${path.basename(latestCsv)}.`);
  } catch (e) {
    console.error(`Error insertando en ${DEFAULT_DB.database}.${DEFAULT_DB.table}:`, e.message || e);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

