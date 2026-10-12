# Gridwork

A Vercel Sudoku photo reader and solver. The browser sends a resized copy of the entire uploaded photo to a Vercel serverless function. The function calls Gemini image understanding and returns a 9 by 9 clue grid with confidence values. The user can edit the clues before the built-in backtracking solver completes the puzzle.

## Configure Gemini

The API key is read only by the serverless function. Do not put it in `app.js`, `index.html`, or another browser file.

For Vercel, open **Project Settings → Environment Variables** and add:

- `GEMINI_API_KEY` — your Gemini API key
- `GEMINI_MODEL` — optional; defaults to `gemini-3.1-flash-lite`

Redeploy after adding or changing environment variables.

For local development, add `GEMINI_API_KEY=...` to `.env.local` and run `npm run dev`. Keep `.env.local` out of source control; it is ignored by `.gitignore`.

## Deploy

Import this folder into Vercel. It is a static frontend plus a Node.js function at `/api/ocr`; no framework build step or npm dependency is required. For local use, `npm run dev` starts the small Node server that serves the same frontend and OCR route.

Upload a clear photo and choose **Read puzzle**. Gemini locates the Sudoku board in the full photo and transcribes the clues; review the grid, then choose **Solve puzzle**. Recognition can still need correction when the photo is blurry, angled, low contrast, or handwritten.

Choose **Analyze steps** to walk through the solution. The solver applies naked and hidden singles, then uses backtracking with the minimum-remaining-values heuristic when a guess is needed. Use **Previous** and **Next** to see the board change one move at a time.

Expand **Check where a number can go** to inspect a selected digit in a row, column, or 3×3 box. It lists legal positions across the grid, explains eliminated cells, and highlights a Hidden Single only when exactly one legal position remains in the chosen unit.
