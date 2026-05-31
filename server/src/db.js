import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const dataDirectory = path.resolve(serverRoot, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath =
  process.env.DATABASE_PATH || path.join(dataDirectory, "demo.sqlite");

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    negocio TEXT NOT NULL,
    rubro TEXT NOT NULL CHECK (rubro IN ('retail', 'restaurante', 'otro')),
    ciudad TEXT NOT NULL,
    telefono TEXT NOT NULL,
    mensaje TEXT,
    origen TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS demo_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_origen ON leads(origen);
  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_demo_events_event ON demo_events(event);
  CREATE INDEX IF NOT EXISTS idx_demo_events_source ON demo_events(source);
`);

const insertLeadStatement = db.prepare(`
  INSERT INTO leads (nombre, negocio, rubro, ciudad, telefono, mensaje, origen, created_at)
  VALUES (@nombre, @negocio, @rubro, @ciudad, @telefono, @mensaje, @origen, @createdAt)
`);

const insertEventStatement = db.prepare(`
  INSERT INTO demo_events (event, source, timestamp)
  VALUES (@event, @source, @timestamp)
`);

const totalsStatement = db.prepare(`
  SELECT
    SUM(CASE WHEN event = 'visit' THEN 1 ELSE 0 END) AS visitas,
    SUM(CASE WHEN event = 'click_whatsapp' THEN 1 ELSE 0 END) AS click_whatsapp
  FROM demo_events
`);

const sourceEventsStatement = db.prepare(`
  SELECT
    source,
    SUM(CASE WHEN event = 'visit' THEN 1 ELSE 0 END) AS visitas,
    SUM(CASE WHEN event = 'click_whatsapp' THEN 1 ELSE 0 END) AS click_whatsapp
  FROM demo_events
  GROUP BY source
`);

const leadsBySourceStatement = db.prepare(`
  SELECT origen AS source, COUNT(*) AS leads
  FROM leads
  GROUP BY origen
`);

const totalLeadsStatement = db.prepare(`
  SELECT COUNT(*) AS total FROM leads
`);

export function insertLead(lead) {
  const result = insertLeadStatement.run(lead);
  return { id: Number(result.lastInsertRowid), ...lead };
}

export function insertDemoEvent(eventInput) {
  const result = insertEventStatement.run(eventInput);
  return { id: Number(result.lastInsertRowid), ...eventInput };
}

export function getMetricsSummary() {
  const eventTotals = totalsStatement.get() || {
    visitas: 0,
    click_whatsapp: 0
  };
  const totalLeads = totalLeadsStatement.get()?.total || 0;
  const rowsBySource = sourceEventsStatement.all();
  const leadRows = leadsBySourceStatement.all();

  const sourceMap = new Map();
  for (const row of rowsBySource) {
    sourceMap.set(row.source, {
      source: row.source,
      visitas: Number(row.visitas || 0),
      click_whatsapp: Number(row.click_whatsapp || 0),
      leads: 0
    });
  }

  for (const row of leadRows) {
    const current = sourceMap.get(row.source) || {
      source: row.source,
      visitas: 0,
      click_whatsapp: 0,
      leads: 0
    };
    current.leads = Number(row.leads || 0);
    sourceMap.set(row.source, current);
  }

  return {
    totals: {
      visitas: Number(eventTotals.visitas || 0),
      click_whatsapp: Number(eventTotals.click_whatsapp || 0),
      leads: Number(totalLeads || 0)
    },
    bySource: Array.from(sourceMap.values()).sort((a, b) =>
      a.source.localeCompare(b.source)
    )
  };
}
