<div align="center">

# PRISM

**Personal productivity app with AI-native spaced repetition — where AI reads your notes and builds your learning system automatically.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-Visit_App-7C3AED?style=for-the-badge)](YOUR_VERCEL_URL)

![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_·_LLaMA_3.3-F55036?style=flat&logo=meta&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white)
![React Query](https://img.shields.io/badge/React_Query-FF4154?style=flat&logo=reactquery&logoColor=white)

Built by a solo founder in 6 sessions using Claude Code.

</div>

## Features

- 🔐 **Auth** — Signup/login with route protection, each user's data fully private (Supabase RLS)
- ✅ **Tasks** — Full CRUD, priority levels, due dates, plan linking, optimistic updates
- 📝 **Notes** — Markdown editor with live preview, tags, full-text search
- 🎯 **Plans** — Project/goal tracking with task progress bars
- 🔔 **Reminders** — Time-based notifications with browser push + in-app bell
- 🧠 **Spaced Repetition** — SM-2 algorithm, flip cards, 4-rating system (Again/Hard/Good/Easy) with interval previews
- ✨ **AI Flashcard Generation** — Paste a note, Groq/LLaMA 3.3-70B generates 4-8 review-ready cards automatically
- 📊 **Learning Analytics** — 30-day review activity chart, mastery tracking, deck performance table
- 📱 **Mobile Responsive** — Full bottom nav, works at 375px

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript) |
| Auth + Database | Supabase (Postgres + RLS) |
| Styling | Tailwind CSS + shadcn/ui |
| AI | Groq API — LLaMA 3.3-70B |
| SRS Algorithm | SM-2 (custom implementation) |
| State | Zustand + React Query |
| Charts | Recharts |
| Deployment | Vercel |

## Screenshots

> 📸 Screenshots coming soon — dashboard, tasks, SRS review, and analytics

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (free at [supabase.com](https://supabase.com))
- A Groq API key (free at [console.groq.com](https://console.groq.com))

### Installation

```bash
git clone https://github.com/UditBuilds/Prism-Productivity-Tool.git
cd Prism-Productivity-Tool
npm install
```

### Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your values:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GROQ_API_KEY` | Groq API key (free tier) |
| `NEXT_PUBLIC_APP_URL` | Your deployment URL |

### Database Setup

Run the SQL schema in your Supabase SQL editor:

```bash
# Schema file is at:
supabase/schema.sql
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Architecture Highlights

- **Private by design** — Row Level Security on all 7 tables. Every query is scoped to the authenticated user at the database level.
- **SM-2 algorithm** — Custom TypeScript implementation of the SuperMemo 2 spaced repetition algorithm. Reviews are scheduled based on difficulty ratings, ease factors, and intervals that grow with each correct recall.
- **AI generation pipeline** — Note content → Groq API (LLaMA 3.3-70B) → JSON parsed + validated → flashcards saved to DB with note_id linkage. Server-side only, API key never exposed to client.
- **Optimistic updates** — All mutations (create/update/delete) reflect instantly in the UI via React Query cache updates, with automatic rollback on server error.

## Roadmap

- [ ] Shared spaces (couple/collab mode)
- [ ] Mobile app (React Native)
- [ ] Streak protection and review streaks
- [ ] Import from Anki / Notion
- [ ] AI note summarization
- [ ] Calendar integration for reminders

## License

MIT

---

Built with Claude Code · Deployed on Vercel · Database by Supabase
