# Lernwelt – Deutsch üben mit Rafi und Ibrahim

Lern-App mit Lernpfad, Sternen, XP, Level, Tages-Serie, Abzeichen, wöchentlichen Hausaufgaben, Schreibaufträgen mit Rückmeldung und einem Lehrer-Bereich. Die Übungen kommen direkt aus den Lernprofilen vom 18.10.2026.

Technik: ein Cloudflare Worker liefert die Seite aus und speichert den Lernstand in einer D1-Datenbank. Kein Build-Schritt, kein Framework.

```
lernwelt/
├─ public/                  ← die App (wird so ausgeliefert)
│  ├─ index.html, app.js, styles.css
│  └─ data/
│     ├─ schueler.json      ← wer auf der Startseite steht, dein Name
│     ├─ ibrahim.json       ← Stationen, Übungen, Abzeichen, Ziele
│     ├─ rafi.json
│     └─ hausaufgaben.json  ← jede Woche hier eintragen
├─ src/worker.js            ← Backend (Speichern, Texte, Lehrer-Bereich)
└─ wrangler.jsonc           ← Cloudflare-Konfiguration
```

---

## 1. Auf GitHub hochladen

1. Auf github.com ein neues **privates** Repository anlegen, z. B. `lernwelt`.
2. Den entpackten Ordner hochladen: entweder im Browser per „uploading an existing file“ (alle Dateien und Ordner hineinziehen) oder im Terminal:

```bash
cd lernwelt
git init
git add .
git commit -m "Lernwelt"
git branch -M main
git remote add origin https://github.com/DEIN-NAME/lernwelt.git
git push -u origin main
```

## 2. Datenbank bei Cloudflare anlegen

1. Im Cloudflare-Dashboard: **Storage & Databases → D1 SQL Database → Create**.
2. Name: `lernwelt-db` → **Create**.
3. Die **Database ID** kopieren und in `wrangler.jsonc` eintragen (Kommentarzeichen entfernen):

```jsonc
"database_name": "lernwelt-db",
"database_id": "hier-die-kopierte-id"
```

4. Änderung auf GitHub hochladen (committen).

Die Tabellen legt die App beim ersten Aufruf selbst an.

## 3. App mit GitHub verbinden

1. **Workers & Pages → Create → Import a repository** → GitHub verbinden → Repository `lernwelt` wählen.
2. Build-Befehl leer lassen, Deploy-Befehl `npx wrangler deploy` (Standard) → **Deploy**.
3. Danach ist die App unter `https://lernwelt.DEIN-KONTO.workers.dev` erreichbar. Eine eigene Domain (z. B. `lernen.studytree.berlin`) kannst du unter **Settings → Domains & Routes** hinzufügen.

Ab jetzt gilt: Jede Änderung, die du auf GitHub pushst, ist nach etwa einer Minute live.

## 4. Lehrer-Schlüssel setzen

Im Worker unter **Settings → Variables and Secrets → Add**:

- Typ: **Secret**
- Name: `TEACHER_KEY`
- Wert: ein Passwort deiner Wahl

Dann auf der Startseite unten „Lehrer-Bereich“ öffnen und den Schlüssel eingeben. Dort siehst du pro Schüler: Level, Serie, letzte Aktivität, Hausaufgaben-Stand, Sterne pro Station, die häufigsten Fehler der letzten 60 Tage, die letzten falschen Antworten und alle abgegebenen Texte. Unter jedem Text schreibst du eine Rückmeldung, die der Schüler unter „Texte“ sieht.

**Vor dem ersten Einsatz:** Wenn du die App selbst ausprobierst, setz danach im Lehrer-Bereich den Fortschritt des Schülers zurück (Link unten in seiner Karte).

---

## Jede Woche: Hausaufgaben eintragen

In `public/data/hausaufgaben.json` beim Schüler einen neuen Block **oben** einfügen:

```json
{
  "id": "2026-kw46",
  "titel": "Woche 2: Diktat und Detektiv",
  "start": "2026-11-09",
  "faellig": "2026-11-15",
  "notiz": "Kurze Nachricht an den Schüler.",
  "aufgaben": [
    { "art": "station", "station": "diktat", "runden": 2 },
    { "art": "station", "station": "detektiv", "runden": 1 },
    { "art": "schreiben", "auftrag": "ib-reiz-nacht" },
    { "art": "aufgabe", "text": "Jeden Tag 10 Minuten laut lesen" }
  ]
}
```

| Art | Wird abgehakt … |
| --- | --- |
| `station` | automatisch, wenn die Runden ab `start` gespielt wurden |
| `schreiben` | automatisch, wenn der Text in der App abgegeben wurde |
| `aufgabe` | vom Schüler selbst (für Dinge außerhalb der App) |

Ist alles erledigt, gibt es +100 XP Bonus, und rechtzeitig fertige Wochen zählen für das Abzeichen „Pünktlich“.

**Stationen Ibrahim:** `erzaehlen`, `nomen`, `dasdass`, `diktat`, `detektiv`, `satzglieder`, `kommas`, `praeteritum`
**Schreibaufträge Ibrahim:** `ib-reiz-gewitter`, `ib-reiz-nacht`, `ib-fussball`, `ib-warum`, `ib-reiz-winter`, `ib-geschenk`

**Stationen Rafi:** `konjunktiv`, `sachtext`, `stilmittel`, `korrektur`, `gliedsatz`, `satzbau`, `argumente`
**Schreibaufträge Rafi:** `ra-indirekt`, `ra-analyse`, `ra-eroerterung`, `ra-stilmittel`, `ra-analyse-voll`, `ra-bbb`, `ra-eroerterung-2`

## Übungen ergänzen oder ändern

Alles steht in `public/data/ibrahim.json` und `public/data/rafi.json`. Jede Station hat ein Feld `aufgaben`. Diese Typen gibt es:

```json
{ "typ": "mc", "frage": "das oder dass?", "satz": "Ich hoffe, ___ es klappt.", "optionen": ["das", "dass"], "loesung": "dass", "erklaerung": "Nach „hoffen“ folgt „dass“." }

{ "typ": "eingabe", "frage": "Schreibe richtig.", "satz": "Die [Haus Tür] ist offen.", "loesung": "Haustür", "erklaerung": "…" }

{ "typ": "diktat", "text": "Der Kühlschrank ist leer.", "tipp": "ein Satz" }

{ "typ": "fehler", "text": "Ich {weis|weiß}, {das|dass} du kommst." }

{ "typ": "komma", "satz": "Ich bleibe zu Hause| weil es regnet.", "erklaerung": "Komma vor „weil“." }
```

- `___` wird zur Lücke, `[…]` wird markiert.
- `loesung` darf bei `eingabe` auch eine Liste sein: `["Türschlüssel", "der Türschlüssel"]`. Groß- und Kleinschreibung zählt (bei Rafis Konjunktiv-Station nicht, dort steht `"egalGross": true`).
- Beim Diktat liest der Browser vor. Gibt es keine deutsche Stimme, zeigt die App das Wort kurz an (merken, dann aus dem Kopf schreiben).
- Bei `fehler` steht jeder Fehler als `{falsch|richtig}`.
- Bei `komma` markiert `|` direkt hinter einem Wort, dass dort ein Komma hingehört.
- Falsch beantwortete Aufgaben kommen in späteren Runden häufiger dran, bis sie sitzen.

Phase-2-Stationen öffnen am 07.12.2026 (`"oeffnetAm"`). Willst du eine früher freischalten, das Datum ändern.

## Spielregeln (für dich zum Erklären)

- Pro richtige Antwort 10 XP, ab 3 richtigen in Folge +2 Bonus. Runde fertig: +20 XP, jeder neue Stern +15 XP.
- Sterne: ab 50 % einer, ab 75 % zwei, ab 90 % drei.
- Serie: Tage in Folge mit mindestens einer Übung.
- Abzeichen für Sterne in jeder Station (passend zu den Förderzielen), für Serien, Hausaufgaben, Texte und Level. Mit höherem Level werden neue Avatare frei.

## Lokal ausprobieren (optional)

```bash
npm install
cp .dev.vars.example .dev.vars   # Lehrer-Schlüssel lokal: test123
npm run dev                       # http://localhost:8787
```
