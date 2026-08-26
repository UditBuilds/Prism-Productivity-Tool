# AI routes — manual end-to-end check

After the `openai/gpt-oss-120b` migration (PR #51, #52), the six AI routes were
verified against the live Groq API at the library level: real prompts, real
responses, real parsing. That covers the model and the parsing code.

It does **not** cover auth, RLS, database persistence, or the UI — those need a
signed-in session on the real account, which agent work deliberately does not
mint. This file is that remaining layer. Work top to bottom; each item says
exactly what to click and exactly what a pass looks like.

Run it signed in as yourself, on `npm run dev` or the deployed app.

> **Before you start**, confirm the environment is sane. If `GROQ_API_KEY` is
> set in the ambient shell, `next dev` launched from that shell will ignore
> `.env.local` and every item below fails with `401 Invalid API Key`:
>
> ```bash
> node -e "console.log('ambient GROQ_API_KEY:', Object.hasOwn(process.env,'GROQ_API_KEY'))"
> ```
>
> It must print `false`. If it prints `true`, unset it and restart the dev
> server.

---

## 1. Notes → flashcards · `/api/srs/generate`

**Trigger**
1. Go to **Notes** (`/dashboard/notes`).
2. Pick a note with at least a couple of paragraphs (the route rejects anything
   under 100 characters).
3. Open the **⋯** menu on that note's card → **Generate Flashcards**.
4. In the modal, leave the count at its default and press the generate button.
5. When the drafts appear, press **Save**.

**Pass**
- A list of draft Q&A cards appears — the number you asked for, give or take.
- Every card has a non-empty question *and* answer, and the last card's answer
  ends in a complete sentence (not mid-word — that would mean truncation).
- After Save, a toast reads **"N cards added to <deck> deck"**.
- The cards are really there: go to **Learn** and confirm the deck's count went
  up by N.

**Fail**
- "Failed to generate cards. Try again." → check the dev-server console for the
  underlying Groq error.
- "Note is too short…" → expected on a very short note; use a longer one.

---

## 2. Note reformat · `/api/notes/reformat`

**Trigger**
1. **Notes** → open a note that is plain unformatted prose (no markdown yet).
2. In the note modal header, press the **Reformat with AI** button
   (the wand icon, `aria-label="Reformat with AI"`).

**Pass**
- The body gains `##` headers, `-` bullets on separate lines, and backticks
  around technical terms.
- **Every word of the original survives.** Skim the end of the note especially
  — the last paragraph must still be there and must not stop mid-sentence.
- The change persists: close and reopen the note.

**Also check the new error path (PR #52).** On a very long note (roughly 15,000+
characters) the free-tier Groq budget can refuse the request outright. It must
now say:

> "This note is too large for the AI's current capacity, so nothing was saved.
> Split it into smaller notes and reformat them separately."

or, if the budget was merely busy:

> "The AI is at capacity right now, so nothing was saved. Try again in about
> N seconds."

**Fail**
- The generic "AI formatting failed. Try again." on a long note means the new
  branch did not fire — capture the dev-server console output.
- Any case where the note content is **shortened** is a hard fail. Nothing
  should ever be saved on an error path.

---

## 3. PDF → flashcards · `/api/pdf/analyze`

**Trigger**
1. **Notes** → the **Import** menu (top right) → **Upload PDF**.
   (Same modal is on **Learn** → **Upload PDF**.)
2. Choose a text-based PDF of 10+ pages — a real one, not a scan.
3. Leave mode on **quick** for the first pass; run it again on **smart** for a
   longer document.
4. Analyze, then **Save** the drafts.

**Pass**
- Draft cards appear and are editable, then save with the usual toast.
- Cards reference actual content from the PDF, not the filename.

**Under-delivery is no longer silent.** Smart mode makes up to 4 sequential Groq
calls, and on the free tier the later ones can be refused. The route still
carries on with whatever succeeded — but it now says so. If a chunk failed you
get an amber banner above the drafts:

> ⚠ 3 of 4 sections couldn't be analyzed, so there are fewer cards than usual.
> Analyzing again in a minute usually picks up the rest.

So a short card list is now self-explaining: banner = chunks failed, no banner =
the AI simply judged that many cards were warranted. **If you get noticeably
fewer cards than you asked for and there is NO banner, that is worth reporting**
— it means the count dropped for a reason nothing is tracking.

Note this is a different banner from the `sampled` one ("Large document —
content was sampled across X of Y pages"). Sampled means we deliberately read
only part of the document; partial means a part we *did* read came back empty.
Both can show at once.

**Fail**
- A scanned PDF is *meant* to fail with a "scanned" message — that is correct,
  there is no OCR by design.

---

## 4. YouTube → flashcards · `/api/youtube/analyze`

**Trigger**
1. Go to **Learn** (`/dashboard/learn`).
2. In the YouTube panel, paste a URL for a video **with captions** and a decent
   amount of speech (10+ minutes is a good test).
3. Set **Cards** and optionally a **Deck** name.
4. Press **Generate flashcards**.

**Pass**
- The button steps through "Fetching transcript…" then "Generating cards…".
- Cards are inserted **straight into the deck** — there is no draft/save step on
  this route, unlike items 1 and 3.
- Open the deck on **Learn** and confirm the new cards are there.
- No card says anything like "the video", "the speaker", or "as mentioned" —
  the prompt forbids it and cards must stand alone.
- If some transcript sections were refused, an amber sub-line appears under the
  success message: *"N of M transcript sections couldn't be analyzed, so this is
  fewer cards than usual."* That is informational — the cards that did generate
  are saved. A long video on a busy minute is the likely trigger.

**Fail**
- "Card generation failed for this video" → every chunk failed; check console.
- A video without captions is expected to fail — try another.
- Noticeably fewer cards than you asked for with **no** sub-line is worth
  reporting: the count dropped without anything tracking why.

---

## 5. YouTube → notes · `/api/youtube/notes`

**Trigger**
1. **Notes** → **Import** menu → **YouTube**.
2. Paste a captioned video URL and submit.

**Pass**
- A new note is created, tagged **`#youtube-import`**.
- The note is real Markdown: `##` section headers and bullets.
- Multi-section notes are separated by a `---` horizontal rule (one section per
  transcript chunk, up to 6).
- Same rule as item 4: no "the video"/"the speaker" phrasing.
- No section ends mid-sentence.
- If some sections were refused, the toast changes from the plain green
  "Note created from …" to an amber ⚠ notice naming how many sections are
  missing. The note is still saved — this tells you it covers only part of the
  video, so you can re-import later if you want the rest.

**Fail**
- "Note generation failed for this video" → all chunks failed; check console.
- A conspicuously short note with a plain success toast is worth reporting —
  every dropped section should be counted.

---

## 6. Workout free-text parse · `POST /api/workouts`

This is the one most sensitive to the model change, so test it with real
shorthand rather than a tidy sentence.

**Trigger** — either entry point:
- **Dashboard** capture field, prefixed with `/w ` (the space is required):
  `/w bench 3x5 @80kg, incline db press 3x10 25kg, assisted pullup 3 sets till failure`
- or **Workout** page (`/dashboard/workout`) → the free-text entry in the log
  sheet.

**Pass**
- The sets appear **structured and grouped by exercise** — e.g. three separate
  Bench Press rows at 80 kg × 5, not one lump.
- `3x5` becomes **three** rows, not one row saying "3".
- Modifiers survive: "assisted pullup" must read **Assisted Pull Up**, never
  "Pull Up". "incline db press" must read **Incline Dumbbell Press**.
- Pounds convert: `Deadlift 225 lbs 5 reps 3 sets` → three rows at **102.06 kg**.
- Cardio is ignored: `/w ran 5k felt great` stores the text but produces no sets.

**Fail — the specific thing to look for**
- A **single row with the raw text and no exercise/weight/reps** is the
  "unparsed row" fallback. It means the Groq call failed or returned unusable
  JSON. The raw text is preserved (nothing is lost), but the parse did not work.
- Long captures are the risk here, though less so than they were. The output
  cap was raised 2000 → 3000, which took the 12-exercise / 44-set reference
  session from **87% of the budget down to 61%**. A very long capture can still
  tip into the fallback. If you hit it, note roughly how many exercises you
  logged — that number is the useful bug report.

---

## 7. Rate limiter still fires

Unrelated to the model, but it wraps all six routes.

**Trigger**
- Press **Reformat with AI** (item 2) repeatedly — more than 20 times inside one
  minute.

**Pass**
- Around the 21st attempt: **"Too many AI requests in a short time. Try again in
  60 seconds."**
- It clears on its own within the minute.

The workout route has its own, higher allowance (100/minute), so normal gym
logging will not trip it.

---

## If something fails

Capture, in this order:

1. The exact on-screen message.
2. The dev-server console lines for that request.
3. The status code from the browser Network tab.

The status code is what separates the causes: **401** is the ambient-key
problem at the top of this file, **404** means the model id is wrong or retired,
**413/429** is the free-tier token budget, and **502/500** is a genuine
generation or parsing failure.
