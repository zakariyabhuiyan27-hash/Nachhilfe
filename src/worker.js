// Lernwelt – Backend (Cloudflare Worker + D1)
// Statische Dateien kommen aus /public, alles unter /api/* landet hier.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS progress (
     student TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student TEXT NOT NULL,
     station TEXT NOT NULL,
     exercise TEXT NOT NULL,
     prompt TEXT,
     answer TEXT,
     solution TEXT,
     score REAL NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student, created_at)`,
  `CREATE TABLE IF NOT EXISTS texts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student TEXT NOT NULL,
     task TEXT NOT NULL,
     title TEXT,
     body TEXT NOT NULL,
     words INTEGER,
     feedback TEXT,
     feedback_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_texts_student ON texts(student, created_at)`,
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const validStudent = (s) => typeof s === "string" && /^[a-z0-9-]{1,30}$/.test(s);
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

async function readBody(request, maxBytes) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("Zu groß");
  return JSON.parse(text || "{}");
}

function isTeacher(request, env) {
  const key = request.headers.get("x-teacher-key") || "";
  return env.TEACHER_KEY && key && key === env.TEACHER_KEY;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!env.DB) return json({ error: "Keine Datenbank verbunden (Binding DB fehlt)." }, 503);

    try {
      await ensureSchema(env.DB);
      const route = `${request.method} ${url.pathname}`;

      // ---------- Schüler: Lernstand ----------
      if (route === "GET /api/state") {
        const s = url.searchParams.get("s");
        if (!validStudent(s)) return json({ error: "Unbekannter Schüler" }, 400);
        const row = await env.DB.prepare("SELECT data, updated_at FROM progress WHERE student = ?").bind(s).first();
        return json(row ? { progress: JSON.parse(row.data), updatedAt: row.updated_at } : { progress: null, updatedAt: 0 });
      }

      if (route === "POST /api/state") {
        const body = await readBody(request, 300_000);
        if (!validStudent(body.student) || typeof body.progress !== "object") return json({ error: "Ungültig" }, 400);
        const now = Date.now();
        await env.DB.prepare(
          `INSERT INTO progress (student, data, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(student) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
        ).bind(body.student, JSON.stringify(body.progress), now).run();
        return json({ ok: true, updatedAt: now });
      }

      // ---------- Schüler: einzelne Antworten (für die Fehleranalyse) ----------
      if (route === "POST /api/attempts") {
        const body = await readBody(request, 100_000);
        if (!validStudent(body.student) || !Array.isArray(body.items)) return json({ error: "Ungültig" }, 400);
        const now = Date.now();
        const stmts = body.items.slice(0, 40).map((it) =>
          env.DB.prepare(
            "INSERT INTO attempts (student, station, exercise, prompt, answer, solution, score, created_at) VALUES (?,?,?,?,?,?,?,?)"
          ).bind(
            body.student,
            clip(it.station, 60) || "?",
            clip(it.exercise, 80) || "?",
            clip(it.prompt, 400),
            clip(it.answer, 400),
            clip(it.solution, 400),
            Math.max(0, Math.min(1, Number(it.score) || 0)),
            now
          )
        );
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true });
      }

      // ---------- Schüler: Texte ----------
      if (route === "POST /api/texts") {
        const body = await readBody(request, 60_000);
        if (!validStudent(body.student) || !body.body || !body.task) return json({ error: "Ungültig" }, 400);
        const text = clip(body.body, 20_000);
        const words = (text.match(/\S+/g) || []).length;
        const r = await env.DB.prepare(
          "INSERT INTO texts (student, task, title, body, words, created_at) VALUES (?,?,?,?,?,?)"
        ).bind(body.student, clip(body.task, 80), clip(body.title, 200), text, words, Date.now()).run();
        return json({ ok: true, id: r.meta?.last_row_id });
      }

      if (route === "GET /api/texts") {
        const s = url.searchParams.get("s");
        if (!validStudent(s)) return json({ error: "Unbekannter Schüler" }, 400);
        const { results } = await env.DB.prepare(
          "SELECT id, task, title, body, words, feedback, feedback_at, created_at FROM texts WHERE student = ? ORDER BY created_at DESC LIMIT 50"
        ).bind(s).all();
        return json({ texts: results });
      }

      // ---------- Lehrer ----------
      if (url.pathname.startsWith("/api/teacher")) {
        if (!env.TEACHER_KEY) return json({ error: "TEACHER_KEY ist in Cloudflare noch nicht gesetzt." }, 503);
        if (!isTeacher(request, env)) return json({ error: "Falscher Lehrer-Schlüssel" }, 401);

        if (route === "GET /api/teacher/overview") {
          const [prog, texts, wrong, recent] = await env.DB.batch([
            env.DB.prepare("SELECT student, data, updated_at FROM progress"),
            env.DB.prepare(
              "SELECT id, student, task, title, body, words, feedback, feedback_at, created_at FROM texts ORDER BY created_at DESC LIMIT 100"
            ),
            env.DB.prepare(
              `SELECT student, station, exercise, prompt, solution,
                      COUNT(*) AS tries, SUM(CASE WHEN score < 1 THEN 1 ELSE 0 END) AS misses,
                      MAX(created_at) AS last_at
                 FROM attempts WHERE created_at > ?
                 GROUP BY student, exercise
                 HAVING misses > 0
                 ORDER BY misses DESC, last_at DESC LIMIT 200`
            ).bind(Date.now() - 1000 * 60 * 60 * 24 * 60),
            env.DB.prepare(
              "SELECT student, station, exercise, prompt, answer, solution, score, created_at FROM attempts WHERE score < 1 ORDER BY created_at DESC LIMIT 150"
            ),
          ]);
          return json({
            progress: prog.results.map((r) => ({ student: r.student, progress: JSON.parse(r.data), updatedAt: r.updated_at })),
            texts: texts.results,
            wrong: wrong.results,
            recentWrong: recent.results,
          });
        }

        if (route === "POST /api/teacher/feedback") {
          const body = await readBody(request, 30_000);
          if (!body.id) return json({ error: "Ungültig" }, 400);
          await env.DB.prepare("UPDATE texts SET feedback = ?, feedback_at = ? WHERE id = ?")
            .bind(clip(body.feedback, 8000), Date.now(), body.id).run();
          return json({ ok: true });
        }

        if (route === "POST /api/teacher/reset") {
          const body = await readBody(request, 2000);
          if (!validStudent(body.student)) return json({ error: "Ungültig" }, 400);
          // Statt zu löschen eine Reset-Markierung speichern: So setzen sich auch Geräte zurück,
          // die noch einen alten Stand im Browser haben.
          await env.DB.batch([
            env.DB.prepare(
              `INSERT INTO progress (student, data, updated_at) VALUES (?, '{"reset":true}', ?)
               ON CONFLICT(student) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
            ).bind(body.student, Date.now()),
            env.DB.prepare("DELETE FROM attempts WHERE student = ?").bind(body.student),
          ]);
          return json({ ok: true });
        }
      }

      return json({ error: "Nicht gefunden" }, 404);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },
};
