# Project rules

## UI copy: no explanatory filler

The owner finds helper remarks "claudey". In anything a user sees (pages, cards,
tiles, empty states, toasts, error and success messages):

- Show labels, numbers, dates and short statuses only ("claimable", "no budget",
  "3 days", "not yet reimbursed").
- Do not add sentences that explain how the app works, reassure, or teach:
  e.g. "Counts toward your Giving budget, not personal spending",
  "Every decision teaches the app", "Swipe right to accept, left to reject",
  "Kept outside personal spending", "Tracked separately from everyday spending".
- No page subtitles that describe the page. No "how to" hints under controls.
- Messages are a few words: "Trip saved", "Removed", "Name and dates needed."
- Exception: a warning the user must act on and can't recover from
  (e.g. a key shown only once) may stay, in as few words as possible.

Explanations belong in chat replies, SETUP.md or code comments, not in the UI.
