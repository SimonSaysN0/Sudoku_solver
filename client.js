const $ = selector => document.querySelector(selector);
const input = $('#file-input');
const dropzone = $('#dropzone');
const image = $('#source-image');
const stage = $('#image-stage');
const readButton = $('#read-button');
const grid = $('#sudoku-grid');
const gridEmpty = $('#grid-empty');
const statusBox = $('#status');

let imageLoaded = false;
let clues = Array(81).fill(0);
let original = Array(81).fill(0);
let confidence = Array(81).fill(0);
let uncertain = Array(81).fill(false);
let analysisSteps = [];
let analysisBase = [];
let analysisIndex = 0;
let puzzleBeforeSolve = null;

function setStatus(message, type = '') {
  statusBox.className = `status${type ? ` ${type}` : ''}`;
  statusBox.lastElementChild.textContent = message;
}

function setProgress(percent, message) {
  $('#progress-text').textContent = message;
  $('#progress-percent').textContent = `${percent}%`;
  $('#progress-bar').style.width = `${percent}%`;
}

function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus('Choose an image file to continue.', 'error');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    setStatus('That image is over 15 MB. Choose a smaller one.', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  image.onload = () => {
    imageLoaded = true;
    $('#empty-state').hidden = true;
    stage.hidden = false;
    $('#image-tools').hidden = false;
    readButton.disabled = false;
    setStatus('Photo ready. The full image will be read by Gemini.');
    URL.revokeObjectURL(url);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Could not open that image. Try another file.', 'error');
  };
  image.src = url;
}

$('#replace-button').onclick = () => input.click();
dropzone.onclick = event => {
  if (!event.target.closest('button,label') && stage.hidden) input.click();
};
dropzone.onkeydown = event => {
  if ((event.key === 'Enter' || event.key === ' ') && stage.hidden) {
    event.preventDefault();
    input.click();
  }
};
input.onchange = event => {
  openFile(event.target.files[0]);
  input.value = '';
};
dropzone.ondragover = event => {
  event.preventDefault();
  dropzone.classList.add('dragging');
};
dropzone.ondragleave = () => dropzone.classList.remove('dragging');
dropzone.ondrop = event => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
  openFile(event.dataTransfer.files[0]);
};

function hideAnalysis() {
  $('#analysis-panel').hidden = true;
  analysisSteps = [];
  analysisBase = [];
  analysisIndex = 0;
}

function makeGrid() {
  hideAnalysis();
  clearCandidateHighlights();
  candidateReturnSolved = false;
  $('#candidate-tools').open = false;
  $('#candidate-summary').className = '';
  $('#candidate-summary').textContent = 'Select a number and row, column, or box to inspect its legal positions.';
  $('#candidate-positions').textContent = '';
  $('#candidate-eliminations').textContent = '';
  $('#candidate-reason').textContent = '';
  grid.replaceChildren();
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('input');
    cell.className = 'cell';
    cell.inputMode = 'numeric';
    cell.maxLength = 1;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `Row ${Math.floor(i / 9) + 1}, column ${i % 9 + 1}`);
    cell.value = clues[i] || '';
    cell.classList.toggle('given', !!original[i]);
    cell.classList.toggle('uncertain', !!uncertain[i] && !!clues[i]);
    if (uncertain[i] && clues[i]) cell.title = `Gemini confidence: ${Math.round(confidence[i])}% — check this clue`;
    cell.oninput = () => {
      const value = cell.value.replace(/[^1-9]/g, '').slice(-1);
      cell.value = value;
      clues[i] = value ? Number(value) : 0;
      original[i] = 0;
      uncertain[i] = false;
      puzzleBeforeSolve = null;
      hideAnalysis();
      [...grid.children].forEach((inputCell, index) => {
        inputCell.value = clues[index] || '';
        inputCell.classList.toggle('given', !!original[index]);
        inputCell.classList.toggle('uncertain', !!uncertain[index] && !!clues[index]);
        inputCell.classList.remove('solved', 'analysis-filled', 'analysis-current');
        inputCell.title = uncertain[index] && clues[index] ? `Gemini confidence: ${Math.round(confidence[index])}% — check this clue` : '';
      });
      gridEmpty.hidden = clues.some(Boolean);
      $('#analyze-button').disabled = !clues.some(Boolean);
      $('#solution-actions').hidden = true;
      checkGrid();
    };
    cell.onkeydown = event => {
      if (event.key === 'ArrowRight') grid.children[Math.min(80, i + 1)].focus();
      if (event.key === 'ArrowLeft') grid.children[Math.max(0, i - 1)].focus();
      if (event.key === 'ArrowDown') grid.children[Math.min(80, i + 9)].focus();
      if (event.key === 'ArrowUp') grid.children[Math.max(0, i - 9)].focus();
    };
    grid.append(cell);
  }
  gridEmpty.hidden = clues.some(Boolean);
  $('#clear-button').disabled = false;
  $('#solve-button').disabled = false;
  $('#analyze-button').disabled = !clues.some(Boolean);
}

function duplicateCells(values = clues) {
  const invalid = new Set();
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const value = values[row * 9 + col];
      if (!value) continue;
      for (let k = 0; k < 9; k++) {
        if (k !== col && values[row * 9 + k] === value) {
          invalid.add(row * 9 + col);
          invalid.add(row * 9 + k);
        }
        if (k !== row && values[k * 9 + col] === value) {
          invalid.add(row * 9 + col);
          invalid.add(k * 9 + col);
        }
        const boxRow = Math.floor(row / 3) * 3 + Math.floor(k / 3);
        const boxCol = Math.floor(col / 3) * 3 + k % 3;
        const boxIndex = boxRow * 9 + boxCol;
        if (boxIndex !== row * 9 + col && values[boxIndex] === value) {
          invalid.add(row * 9 + col);
          invalid.add(boxIndex);
        }
      }
    }
  }
  return invalid;
}

function checkGrid() {
  const invalid = duplicateCells();
  [...grid.children].forEach((cell, index) => cell.classList.toggle('invalid', invalid.has(index)));
  return invalid;
}

$('#clear-button').onclick = () => {
  puzzleBeforeSolve = null;
  clues = Array(81).fill(0);
  original = Array(81).fill(0);
  confidence = Array(81).fill(0);
  uncertain = Array(81).fill(false);
  makeGrid();
  $('#solution-actions').hidden = true;
  setStatus('Grid cleared.');
};

$('#reset-button').onclick = () => {
  puzzleBeforeSolve = null;
  clues = Array(81).fill(0);
  original = Array(81).fill(0);
  confidence = Array(81).fill(0);
  uncertain = Array(81).fill(false);
  makeGrid();
  $('#solution-actions').hidden = true;
  $('#image-tools').hidden = true;
  stage.hidden = true;
  $('#empty-state').hidden = false;
  imageLoaded = false;
  readButton.disabled = true;
  input.value = '';
  setStatus('Upload a photo to get started.');
};

function cellContext(board, index) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const boxRow = Math.floor(row / 3);
  const boxCol = Math.floor(col / 3);
  const rowValues = [...new Set(board.slice(row * 9, row * 9 + 9).filter(Boolean))].sort();
  const columnValues = [...new Set(Array.from({ length: 9 }, (_, r) => board[r * 9 + col]).filter(Boolean))].sort();
  const boxValues = [];
  for (let r = boxRow * 3; r < boxRow * 3 + 3; r++) {
    for (let c = boxCol * 3; c < boxCol * 3 + 3; c++) {
      if (board[r * 9 + c]) boxValues.push(board[r * 9 + c]);
    }
  }
  const uniqueBoxValues = [...new Set(boxValues)].sort();
  const used = new Set([...rowValues, ...columnValues, ...uniqueBoxValues]);
  return {
    row: row + 1,
    column: col + 1,
    box: boxRow * 3 + boxCol + 1,
    rowValues,
    columnValues,
    boxValues: uniqueBoxValues,
    candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(value => !used.has(value)),
  };
}

function cellCandidates(board, index) {
  return cellContext(board, index).candidates;
}

function digitBlocker(board, index, value) {
  const context = cellContext(board, index);
  const row = Math.floor(index / 9);
  const col = index % 9;
  if (context.rowValues.includes(value)) return { type: 'row', number: context.row, index: row * 9 + board.slice(row * 9, row * 9 + 9).indexOf(value) };
  if (context.columnValues.includes(value)) {
    const blockerRow = Array.from({ length: 9 }, (_, r) => r).find(r => board[r * 9 + col] === value);
    return { type: 'column', number: context.column, index: blockerRow * 9 + col };
  }
  if (context.boxValues.includes(value)) {
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        if (board[r * 9 + c] === value) return { type: 'box', number: context.box, index: r * 9 + c };
      }
    }
  }
  return null;
}

let candidateAnalysisActive = false;
let candidateReturnSolved = false;

function clearCandidateHighlights() {
  const candidateClasses = [
    'candidate-unit', 'candidate-global', 'candidate-eliminated', 'candidate-possible',
    'candidate-existing', 'candidate-unique', 'candidate-unit-top', 'candidate-unit-bottom',
    'candidate-unit-left', 'candidate-unit-right',
  ];
  [...grid.children].forEach(cell => {
    cell.classList.remove(...candidateClasses);
    cell.placeholder = '';
  });
  candidateAnalysisActive = false;
}

function renderDisplayedBoard(values, { locked = false, puzzle = false } = {}) {
  [...grid.children].forEach((cell, index) => {
    cell.value = values[index] || '';
    cell.readOnly = locked;
    cell.classList.toggle('given', puzzle ? !!values[index] : !!original[index]);
    cell.classList.toggle('uncertain', !!values[index] && !!uncertain[index]);
    cell.classList.toggle('solved', !puzzle && !original[index] && !$('#solution-actions').hidden);
    cell.classList.remove('analysis-filled', 'analysis-current');
  });
  gridEmpty.hidden = values.some(Boolean);
}

function selectedUnitCells(type, number) {
  if (type === 'row') return Array.from({ length: 9 }, (_, col) => (number - 1) * 9 + col);
  if (type === 'column') return Array.from({ length: 9 }, (_, row) => row * 9 + number - 1);
  const boxRow = Math.floor((number - 1) / 3);
  const boxCol = (number - 1) % 3;
  const cells = [];
  for (let row = boxRow * 3; row < boxRow * 3 + 3; row++) {
    for (let col = boxCol * 3; col < boxCol * 3 + 3; col++) cells.push(row * 9 + col);
  }
  return cells;
}

function cellLabel(index) {
  return `R${Math.floor(index / 9) + 1}C${index % 9 + 1}`;
}

function unitLabel(type, number) {
  if (type === 'row') return `row ${number}`;
  if (type === 'column') return `column ${number}`;
  const boxRow = Math.floor((number - 1) / 3) * 3 + 1;
  const boxCol = ((number - 1) % 3) * 3 + 1;
  return `box ${number} (rows ${boxRow}–${boxRow + 2}, columns ${boxCol}–${boxCol + 2})`;
}

function markUnitEdges(cells, type, number) {
  const boxRow = Math.floor((number - 1) / 3) * 3;
  const boxCol = ((number - 1) % 3) * 3;
  cells.forEach(index => {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const cell = grid.children[index];
    if (type === 'row') {
      if (col === 0) cell.classList.add('candidate-unit-left');
      if (col === 8) cell.classList.add('candidate-unit-right');
      cell.classList.add('candidate-unit-top', 'candidate-unit-bottom');
    } else if (type === 'column') {
      if (row === 0) cell.classList.add('candidate-unit-top');
      if (row === 8) cell.classList.add('candidate-unit-bottom');
      cell.classList.add('candidate-unit-left', 'candidate-unit-right');
    } else {
      if (row === boxRow) cell.classList.add('candidate-unit-top');
      if (row === boxRow + 2) cell.classList.add('candidate-unit-bottom');
      if (col === boxCol) cell.classList.add('candidate-unit-left');
      if (col === boxCol + 2) cell.classList.add('candidate-unit-right');
    }
  });
}

function renderCandidateAnalysis() {
  const board = (puzzleBeforeSolve || clues).slice();
  const digit = Number($('#candidate-digit').value);
  const type = $('#candidate-unit-type').value;
  const number = Number($('#candidate-unit-number').value);
  const unit = selectedUnitCells(type, number);
  const location = unitLabel(type, number);
  const report = {
    summary: $('#candidate-summary'),
    positions: $('#candidate-positions'),
    eliminations: $('#candidate-eliminations'),
    reason: $('#candidate-reason'),
  };

  if (!candidateAnalysisActive) candidateReturnSolved = !$('#solution-actions').hidden;
  clearCandidateHighlights();
  hideAnalysis();
  $('#solution-actions').hidden = true;
  renderDisplayedBoard(board, { locked: true, puzzle: true });
  candidateAnalysisActive = true;
  const fail = message => {
    report.summary.className = 'candidate-alert';
    report.summary.textContent = message;
    report.positions.textContent = '';
    report.eliminations.textContent = '';
    report.reason.textContent = '';
  };
  if (!board.some(Boolean)) return fail('Enter or read a Sudoku grid before checking candidates.');
  if (duplicateCells(board).size) return fail('This grid has repeated numbers in a row, column, or box. Fix the conflicts before analyzing candidates.');
  if (!analyzeSudoku(board)) return fail('This puzzle has no valid solution. Check the clues before analyzing candidates.');
  report.summary.className = '';
  report.summary.textContent = `Checking number ${digit} in ${location}.`;

  const allPositions = [];
  for (let index = 0; index < 81; index++) {
    if (!board[index] && cellCandidates(board, index).includes(digit)) allPositions.push(index);
  }
  const existing = unit.find(index => board[index] === digit);
  const candidates = unit.filter(index => !board[index] && cellCandidates(board, index).includes(digit));
  const eliminated = unit
    .filter(index => !board[index] && !cellCandidates(board, index).includes(digit))
    .map(index => ({ index, blocker: digitBlocker(board, index, digit) }))
    .filter(item => item.blocker);

  for (const index of allPositions) {
    grid.children[index].classList.add('candidate-global');
    grid.children[index].placeholder = String(digit);
  }
  for (const index of unit) {
    const cell = grid.children[index];
    cell.classList.add('candidate-unit');
    if (board[index] === digit) cell.classList.add('candidate-existing');
    else if (board[index]) continue;
    else if (candidates.includes(index)) cell.classList.add('candidate-possible');
    else cell.classList.add('candidate-eliminated');
  }
  markUnitEdges(unit, type, number);
  report.summary.className = '';
  report.positions.textContent = `Number ${digit} can legally go in ${allPositions.length ? allPositions.map(cellLabel).join(', ') : 'no empty cells'} across the grid.`;
  if (existing !== undefined) {
    report.eliminations.textContent = '';
    report.reason.className = 'candidate-alert';
    report.reason.textContent = `Number ${digit} is already in ${location} at ${cellLabel(existing)}; it cannot be placed there again.`;
    return;
  }

  report.eliminations.className = '';
  report.eliminations.textContent = eliminated.length
    ? `In ${location}, other empty cells are eliminated: ${eliminated.map(({ index, blocker }) => `${cellLabel(index)} because ${blocker.type} ${blocker.number} already has ${digit} at ${cellLabel(blocker.index)}`).join('; ')}.`
    : `There are no other empty cells in ${location} to eliminate.`;
  if (candidates.length === 1) {
    const index = candidates[0];
    const context = cellContext(board, index);
    grid.children[index].classList.add('candidate-unique');
    report.reason.className = 'candidate-conclusion';
    if (context.candidates.length === 1) {
      report.reason.textContent = `Number ${digit} — Only Possible Position: ${cellLabel(index)} is also a Naked Single. Its row, column, and box rule out all other digits, leaving ${digit}. Place it there.`;
    } else {
      report.reason.textContent = `Number ${digit} — Only Possible Position: after eliminating the other cells in ${location}, only ${cellLabel(index)} remains. Place ${digit} there.`;
    }
  } else if (candidates.length > 1) {
    report.reason.className = '';
    report.reason.textContent = `${candidates.length} possible positions remain in ${location}: ${candidates.map(cellLabel).join(', ')}. This is not a Hidden Single.`;
  } else {
    report.reason.className = 'candidate-alert';
    report.reason.textContent = `No position for ${digit} remains in ${location}, but the number is not already there. The clues contradict this unit.`;
  }
}

$('#candidate-unit-type').onchange = () => {
  const type = $('#candidate-unit-type').value;
  $('#candidate-unit-label').textContent = type === 'box' ? 'Box' : type === 'row' ? 'Row' : 'Column';
  if (candidateAnalysisActive) renderCandidateAnalysis();
};
$('#candidate-digit').onchange = () => { if (candidateAnalysisActive) renderCandidateAnalysis(); };
$('#candidate-unit-number').onchange = () => { if (candidateAnalysisActive) renderCandidateAnalysis(); };
$('#candidate-analyze').onclick = renderCandidateAnalysis;
$('#candidate-tools').addEventListener('toggle', () => {
  if ($('#candidate-tools').open || !candidateAnalysisActive) return;
  clearCandidateHighlights();
  renderDisplayedBoard(clues);
  $('#solution-actions').hidden = !candidateReturnSolved;
  if (!$('#solution-actions').hidden) {
    [...grid.children].forEach((cell, index) => cell.classList.toggle('solved', !original[index]));
  }
  candidateReturnSolved = false;
});

function sudokuUnits() {
  const units = [];
  for (let row = 0; row < 9; row++) units.push({ type: 'row', number: row + 1, cells: Array.from({ length: 9 }, (_, col) => row * 9 + col) });
  for (let col = 0; col < 9; col++) units.push({ type: 'column', number: col + 1, cells: Array.from({ length: 9 }, (_, row) => row * 9 + col) });
  for (let boxRow = 0; boxRow < 3; boxRow++) {
    for (let boxCol = 0; boxCol < 3; boxCol++) {
      const number = boxRow * 3 + boxCol + 1;
      const cells = [];
      for (let row = boxRow * 3; row < boxRow * 3 + 3; row++) {
        for (let col = boxCol * 3; col < boxCol * 3 + 3; col++) cells.push(row * 9 + col);
      }
      units.push({ type: 'box', number, cells });
    }
  }
  return units;
}

const allUnits = sudokuUnits();

function analyzeSudoku(values) {
  function search(board, steps) {
    while (true) {
      const empty = [];
      for (let index = 0; index < 81; index++) {
        if (!board[index]) {
          const candidates = cellCandidates(board, index);
          if (!candidates.length) return null;
          empty.push({ index, candidates });
        }
      }
      if (!empty.length) return { solution: board, steps };

      const naked = empty.find(cell => cell.candidates.length === 1);
      if (naked) {
        const { index, candidates } = naked;
        const value = candidates[0];
        const context = cellContext(board, index);
        board[index] = value;
        steps.push({ type: 'naked', index, value, candidates, context });
        continue;
      }

      let hidden = null;
      for (const unit of allUnits) {
        const present = new Set(unit.cells.map(index => board[index]).filter(Boolean));
        for (let value = 1; value <= 9 && !hidden; value++) {
          if (present.has(value)) continue;
          const places = empty.filter(cell => unit.cells.includes(cell.index) && cell.candidates.includes(value));
          if (!places.length) return null;
          if (places.length === 1) {
            const blockedBy = unit.cells
              .filter(index => !board[index] && index !== places[0].index)
              .map(index => ({ index, blocker: digitBlocker(board, index, value) }))
              .filter(item => item.blocker);
            hidden = { ...places[0], value, unit, blockedBy };
          }
        }
        if (hidden) break;
      }
      if (hidden) {
        board[hidden.index] = hidden.value;
        steps.push({ type: 'hidden', index: hidden.index, value: hidden.value, unit: hidden.unit, blockedBy: hidden.blockedBy });
        continue;
      }
      break;
    }

    const options = [];
    for (let index = 0; index < 81; index++) {
      if (!board[index]) options.push({ index, candidates: cellCandidates(board, index) });
    }
    options.sort((a, b) => a.candidates.length - b.candidates.length);
    const choice = options[0];
    if (!choice || !choice.candidates.length) return null;

    for (const value of choice.candidates) {
      const branch = board.slice();
      branch[choice.index] = value;
      const result = search(branch, [...steps, {
        type: 'guess', index: choice.index, value, candidates: choice.candidates,
      }]);
      if (result) return result;
      steps.push({ type: 'backtrack', index: choice.index, value, candidates: choice.candidates });
    }
    return null;
  }

  return search(values.slice(), []);
}

function solve(values) {
  return analyzeSudoku(values)?.solution || null;
}

function stepDescription(step) {
  if (step.type === 'start') {
    return analysisSteps.length === 1
      ? { label: 'Already complete', text: 'This puzzle has no empty cells to reveal.' }
      : { label: 'Starting puzzle', text: 'This is the original Sudoku. Choose Next move to reveal the first filled cell.' };
  }
  const row = Math.floor(step.index / 9) + 1;
  const col = step.index % 9 + 1;
  const cell = `R${row}C${col}`;
  if (step.type === 'naked') {
    const list = values => values.length ? values.join(', ') : 'none';
    const context = step.context;
    return {
      label: 'Naked single',
      text: `${cell} has only one candidate: ${step.value}. Row ${context.row} already contains ${list(context.rowValues)}; column ${context.column} contains ${list(context.columnValues)}; and box ${context.box} contains ${list(context.boxValues)}. Together, those digits rule out every other number from 1 to 9, leaving ${step.value}. Place it there.`,
    };
  }
  if (step.type === 'hidden') {
    const unitName = step.unit.type === 'box' ? `3×3 box ${step.unit.number}` : `${step.unit.type} ${step.unit.number}`;
    const blocked = step.blockedBy.map(({ index, blocker }) => {
      const blockedCell = `R${Math.floor(index / 9) + 1}C${index % 9 + 1}`;
      return `${blockedCell} is blocked by ${blocker.type} ${blocker.number}, where ${step.value} is already at ${cellLabel(blocker.index)}`;
    });
    const explanation = blocked.length ? ` The other empty cells are eliminated: ${blocked.join('; ')}.` : '';
    return { label: 'Hidden single', text: `${step.value} has only one available position in ${unitName}: ${cell}.${explanation} Place ${step.value} there.` };
  }
  if (step.type === 'guess') return { label: 'Try a candidate', text: `No forced move is available. ${cell} has the fewest candidates among the empty cells (${step.candidates.join(', ')}), so try ${step.value} there first.` };
  if (step.type === 'backtrack') return { label: 'Backtrack', text: `That trial leads to a contradiction. Undo ${step.value} in ${cell} and test the next candidate.` };
  return { label: 'Complete', text: 'Every cell is filled and all rows, columns, and boxes are valid.' };
}

function showAnalysisStep(index) {
  analysisIndex = Math.max(0, Math.min(index, analysisSteps.length - 1));
  const step = analysisSteps[analysisIndex];
  const description = stepDescription(step);
  const board = analysisBase.slice();
  for (let i = 0; i <= analysisIndex; i++) {
    const current = analysisSteps[i];
    if (['naked', 'hidden', 'guess'].includes(current.type)) board[current.index] = current.value;
    if (current.type === 'backtrack' && !analysisBase[current.index]) board[current.index] = 0;
  }
  [...grid.children].forEach((cell, cellIndex) => {
    cell.value = board[cellIndex] || '';
    cell.classList.toggle('analysis-filled', !analysisBase[cellIndex] && !!board[cellIndex]);
    cell.classList.toggle('analysis-current', step.index >= 0 && cellIndex === step.index);
    cell.classList.toggle('solved', false);
    cell.classList.toggle('given', !!analysisBase[cellIndex]);
    cell.classList.toggle('uncertain', !!analysisBase[cellIndex] && !!uncertain[cellIndex]);
  });
  const moveCount = Math.max(0, analysisSteps.length - 1);
  $('#analysis-count').textContent = step.type === 'start' ? 'Puzzle' : `Step ${analysisIndex} / ${moveCount}`;
  $('#analysis-technique').textContent = description.label;
  $('#analysis-text').textContent = description.text;
  $('#analysis-prev').disabled = analysisIndex === 0;
  $('#analysis-next').disabled = analysisIndex === analysisSteps.length - 1;
}

$('#analyze-button').onclick = () => {
  const invalid = checkGrid();
  if (invalid.size) return setStatus('There are conflicting clues. Edit the highlighted cells.', 'error');
  if (!clues.some(Boolean)) return setStatus('Read a photo or enter a few clues first.', 'error');
  clearCandidateHighlights();
  $('#candidate-tools').open = false;
  const startingPuzzle = puzzleBeforeSolve || clues;
  const result = analyzeSudoku(startingPuzzle);
  if (!result) return setStatus('No solution found. Check the clues and try again.', 'error');
  analysisBase = startingPuzzle.slice();
  analysisSteps = [
    { type: 'start', index: -1 },
    ...result.steps,
  ];
  $('#analysis-panel').hidden = false;
  $('#solution-actions').hidden = true;
  showAnalysisStep(0);
  setStatus(`Analysis ready: ${result.steps.length} moves to the solution.`, 'success');
};

$('#analysis-prev').onclick = () => showAnalysisStep(analysisIndex - 1);
$('#analysis-next').onclick = () => showAnalysisStep(analysisIndex + 1);

let swipeOrigin = null;
$('.grid-wrap').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'touch') return;
  swipeOrigin = { x: event.clientX, y: event.clientY };
});
$('.grid-wrap').addEventListener('pointerup', event => {
  if (!swipeOrigin || $('#analysis-panel').hidden) return;
  const deltaX = event.clientX - swipeOrigin.x;
  const deltaY = event.clientY - swipeOrigin.y;
  swipeOrigin = null;
  if (Math.abs(deltaX) < 55 || Math.abs(deltaY) > 70) return;
  // Swipe right advances to the next placement; swipe left goes back.
  showAnalysisStep(analysisIndex + (deltaX > 0 ? 1 : -1));
});
$('.grid-wrap').addEventListener('pointercancel', () => { swipeOrigin = null; });

$('#solve-button').onclick = () => {
  const invalid = checkGrid();
  if (invalid.size) return setStatus('There are conflicting clues. Edit the highlighted cells.', 'error');
  if (!clues.some(Boolean)) return setStatus('Read a photo or enter a few clues first.', 'error');
  const startingPuzzle = clues.slice();
  const answer = solve(startingPuzzle);
  if (!answer) return setStatus('No solution found. Check the clues and try again.', 'error');
  puzzleBeforeSolve = startingPuzzle;
  hideAnalysis();
  clues = answer;
  makeGrid();
  [...grid.children].forEach((cell, index) => {
    if (!original[index]) cell.classList.add('solved');
  });
  gridEmpty.hidden = true;
  $('#solution-actions').hidden = false;
  setStatus('Every row, column, and box is complete.', 'success');
};

function fullImageAsJpeg() {
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

readButton.onclick = async () => {
  if (!imageLoaded) return;
  readButton.disabled = true;
  $('#ocr-progress').hidden = false;
  setProgress(8, 'Preparing the full photo…');
  setStatus('Reading clues with Gemini…');
  try {
    const fullImage = fullImageAsJpeg();
    setProgress(35, 'Sending the full photo for recognition…');
    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: fullImage, mimeType: 'image/jpeg' }),
      signal: AbortSignal.timeout(55_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Gemini could not read this image.');
    if (!Array.isArray(result.grid) || result.grid.length !== 9 || result.grid.some(row => !Array.isArray(row) || row.length !== 9)) {
      throw new Error('Gemini returned an invalid grid. Please try again.');
    }

    puzzleBeforeSolve = null;
    clues = result.grid.flat().map(value => Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0);
    confidence = Array.isArray(result.confidence) && result.confidence.length === 9
      ? result.confidence.flat().map(value => Number.isFinite(value) ? value : 0)
      : Array(81).fill(60);
    original = clues.slice();
    uncertain = clues.map((value, index) => value !== 0 && confidence[index] < 70);
    makeGrid();
    $('#solution-actions').hidden = true;
    const invalid = checkGrid();
    const count = clues.filter(Boolean).length;
    const review = uncertain.filter(Boolean).length;
    const message = invalid.size
      ? `Gemini read ${count} clues. ${invalid.size} conflict; review highlighted cells.`
      : `Gemini read ${count} clues${review ? `; ${review} marked for review` : ''}. Check the grid, then solve.`;
    setStatus(message, invalid.size ? 'error' : 'success');
    setProgress(100, 'Recognition complete');
  } catch (error) {
    const message = error.name === 'TypeError' || error.name === 'AbortError'
      ? 'This preview has no OCR API. Open http://localhost:3000 after starting npm run dev, or use the Vercel deployment with GEMINI_API_KEY configured.'
      : error.message || 'Could not read this photo. Check the crop and try again.';
    setStatus(message, 'error');
  } finally {
    readButton.disabled = false;
    window.setTimeout(() => { $('#ocr-progress').hidden = true; }, 1200);
  }
};

makeGrid();
$('#clear-button').disabled = true;
$('#solve-button').disabled = true;
