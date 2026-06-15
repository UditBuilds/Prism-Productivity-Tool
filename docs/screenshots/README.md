# Screenshots

This folder holds the images referenced by the root `README.md`. Drop PNGs here
with the exact filenames below and they'll render automatically.

## Capture checklist

| Filename | Screen | What to show |
|----------|--------|--------------|
| `dashboard.png` | Dashboard | Greeting, KPI cards, "Due Today", upcoming countdowns |
| `srs-review.png` | Learn → Review | A flipped flashcard with the 4-grade rating row |
| `ai-generation.png` | Learn / Notes | The PDF or YouTube → flashcards modal mid-generation or on the preview step |
| `notes.png` | Notes | The read-mode note modal with rendered markdown + tags |
| `calendar.png` | Calendar | The IST month grid with task/reminder dots and the day panel |
| `analytics.png` | Learn → Analytics | The productivity charts (focus trend, category split) |
| `mobile.png` | Any page @ 390px | Mobile layout with the bottom nav (shows the PWA/responsive story) |

## How to capture

1. Run the app (`npm run dev`) and sign in with some seed data.
2. **Desktop shots:** a viewport around **1440×900**; capture the content area,
   not the whole OS window.
3. **Mobile shot:** use browser device emulation at **390×844** (iPhone),
   or screenshot the installed PWA.
4. Export as **PNG**, keep each file roughly **< 500 KB** (optimize if needed).
5. Save here using the filenames above and commit.

## Tips

- Use realistic-but-not-sensitive content.
- Dark mode only — the app has no light theme, so all shots should be dark.
- Keep the accent color consistent across shots for a cohesive gallery.
