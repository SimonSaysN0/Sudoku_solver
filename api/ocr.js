const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_TOTAL_IMAGE_CHARS = 3_500_000;

function send(res, status, body) {
  res.status(status).json(body);
}

function validGrid(grid) {
  return Array.isArray(grid) && grid.length === 9 && grid.every(row =>
    Array.isArray(row) && row.length === 9 && row.every(value =>
      Number.isInteger(value) && value >= 0 && value <= 9
    )
  );
}

function validConfidence(grid) {
  return Array.isArray(grid) && grid.length === 9 && grid.every(row =>
    Array.isArray(row) && row.length === 9 && row.every(value =>
      Number.isFinite(value) && value >= 0 && value <= 100
    )
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST to read a Sudoku image.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 503, { error: 'Gemini is not configured. Add GEMINI_API_KEY to the Vercel project environment variables.' });
  }

  const { image, mimeType } = req.body || {};
  if (typeof image !== 'string' || image.length < 16 || image.length > MAX_TOTAL_IMAGE_CHARS) {
    return send(res, 400, { error: 'The image is missing or too large. Choose a smaller photo and try again.' });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return send(res, 415, { error: 'Use a JPEG, PNG, or WEBP image.' });
  }

  const schema = {
    type: 'object',
    properties: {
      grid: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'integer', minimum: 0, maximum: 9 } } },
      confidence: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'integer', minimum: 0, maximum: 100 } } },
    },
    required: ['grid', 'confidence'],
    additionalProperties: false,
  };
  const prompt = [
    'The input is a full photo, which may contain margins, background, or other objects. Find the single 9 by 9 Sudoku board in the photo, determine its orientation, and transcribe only the printed clues into their exact row and column positions.',
    'Read each cell visually. Use 0 for every empty cell. Do not solve the puzzle or use Sudoku rules to infer, add, or change clues.',
    'Ignore grid lines, labels, page text, shadows, and marks outside the Sudoku board. If no board is clearly visible or a digit is unreadable, use 0 for that cell and give it low confidence.',
    'Return exactly 9 rows and 9 columns. Also return a confidence grid with an integer from 0 to 100 for each cell.',
    'Use confidence 0 for empty cells. Be conservative: if a cell is unclear, use 0 in the clue grid and a low confidence score.',
  ].join(' ');

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: image } },
          { text: prompt },
        ] }],
        generationConfig: {
          temperature: 0,
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload?.error?.message || 'Gemini could not read this image.';
      return send(res, response.status === 429 ? 429 : 502, { error: detail });
    }

    const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!text) return send(res, 502, { error: 'Gemini returned no grid. Try a sharper photo with the full board inside the selection.' });

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return send(res, 502, { error: 'Gemini returned an unreadable grid. Please try again.' });
    }
    if (!validGrid(result.grid)) {
      return send(res, 502, { error: 'Gemini did not return a 9 by 9 grid. Please adjust the crop and retry.' });
    }

    const confidence = validConfidence(result.confidence)
      ? result.confidence
      : result.grid.map(row => row.map(value => value === 0 ? 0 : 60));
    return send(res, 200, { grid: result.grid, confidence });
  } catch (error) {
    console.error('Gemini Sudoku OCR error:', error);
    return send(res, 502, { error: 'Could not reach Gemini. Check your deployment environment and try again.' });
  }
};
