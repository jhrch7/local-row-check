(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let generation = 0, left = null, right = null, report = null, downloadUrl = null, exampleBytes = null;
  const delimiter = () => $('delimiter').value === 'tab' ? '\t' : $('delimiter').value;
  const chosenColumns = () => [...$('column-options').querySelectorAll('input:checked')].map(input => input.value);
  function status(text) { $('status').textContent = text; }
  function invalidate() {
    generation++; report = null; $('results').hidden = true; $('download').disabled = true;
    $('error').hidden = true; $('error').textContent = '';
    $('counts').replaceChildren(); $('preview').querySelector('thead').replaceChildren(); $('preview').querySelector('tbody').replaceChildren();
    $('value-summary').textContent = ''; $('hashes').textContent = '';
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
    $('compare').disabled = !(left && right && $('key').value);
  }
  function showError(error) {
    $('error').textContent = error.message || String(error); $('error').hidden = false; status('No report created. Check the files and try again.');
  }
  function resetRules() {
    $('key').replaceChildren(new Option('Choose both files first', '')); $('key').disabled = true;
    $('columns').disabled = true; $('column-options').textContent = 'Choose a key to see the available columns.';
  }
  function makeColumns(selected = []) {
    $('column-options').replaceChildren(); $('columns').disabled = !$('key').value;
    if (!$('key').value) { $('column-options').textContent = 'Choose a key to see the available columns.'; return; }
    const available = left.columns.filter(c => right.columns.includes(c) && c !== $('key').value);
    if (!available.length) $('column-options').textContent = 'No other shared columns. This will compare keys only.';
    for (const column of available) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = column; input.checked = selected.includes(column);
      input.addEventListener('change', () => { invalidate(); status('Options changed. Compare files to create a new report.'); });
      label.append(input, document.createTextNode(column)); $('column-options').append(label);
    }
  }
  async function loadFiles(fromExample = false) {
    left = right = null; invalidate(); resetRules(); const token = generation;
    const files = fromExample ? exampleBytes : [$('left-file').files[0], $('right-file').files[0]];
    $('left-name').textContent = files?.[0]?.name ? (fromExample ? 'Included example: ' : '') + files[0].name : 'No file selected';
    $('right-name').textContent = files?.[1]?.name ? (fromExample ? 'Included example: ' : '') + files[1].name : 'No file selected';
    if (!files?.[0] || !files?.[1]) { status('Choose both files to continue.'); return; }
    status('Reading files on this device…');
    try {
      const loaded = await Promise.all(files.map(async f => {
        if (f.size > RowCheck.MAX_BYTES) throw new Error(f.name + ': the browser edition accepts up to 2 MiB per file.');
        return RowCheck.readBytes(await f.arrayBuffer(), f.name, delimiter());
      }));
      if (token !== generation) return;
      const common = loaded[0].columns.filter(c => loaded[1].columns.includes(c));
      if (!common.length) throw new Error('No shared column header. Choose files with a common key column, using exactly the same header text.');
      [left, right] = loaded;
      $('key').replaceChildren(new Option('Choose a key column', ''), ...common.map(c => new Option(c, c))); $('key').disabled = false;
      if (fromExample && common.includes('SKU')) {
        $('key').value = 'SKU'; makeColumns(['Price', 'Stock']); $('compare').disabled = false;
        status('Example loaded. Compare files to inspect its three changed cells and review rows.');
      } else status('Files read locally. Choose the key column and optional value columns.');
    } catch (error) {
      if (token !== generation) return;
      left = right = null; resetRules(); $('compare').disabled = true; showError(error);
    }
  }
  function cell(tag, value) { const el = document.createElement(tag); el.textContent = String(value); return el; }
  function preview() {
    const name = $('preview-file').value, rows = report.tables[name], table = $('preview');
    table.querySelector('thead').replaceChildren(); table.querySelector('tbody').replaceChildren();
    const heading = document.createElement('tr'); for (const value of rows[0]) { const th = cell('th', value); th.scope = 'col'; heading.append(th); }
    table.querySelector('thead').append(heading);
    for (const row of rows.slice(1, 21)) { const tr = document.createElement('tr'); for (const value of row) tr.append(cell('td', value)); table.querySelector('tbody').append(tr); }
    $('preview-count').textContent = (rows.length - 1) + ' data rows in this report';
  }
  function showReport() {
    const manifest = report.manifest;
    for (const side of ['left', 'right']) {
      const count = manifest.counts[side], tr = document.createElement('tr');
      for (const value of [side === 'left' ? 'Left' : 'Right', count.input, count.only, count.shared, count.review]) tr.append(cell('td', value));
      $('counts').append(tr);
    }
    const values = manifest.value_comparison;
    const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');
    $('value-summary').textContent = values ? plural(values.shared_keys_compared, 'unique shared key') + ' compared · ' + plural(values.keys_with_changes, 'key') + ' with changes · ' + plural(values.changed_cells, 'changed cell') : 'Keys compared only. No value columns were selected.';
    const labels = {'only_left.csv': 'Only in left', 'only_right.csv': 'Only in right', 'review.csv': 'Rows for review', 'shared_keys.csv': 'Unique shared keys', 'value_changes.csv': 'Changed values'};
    $('preview-file').replaceChildren(...Object.keys(report.tables).map(name => new Option(labels[name], name)));
    $('preview-file').value = values ? 'value_changes.csv' : 'review.csv'; preview();
    $('hashes').textContent = ['left', 'right'].map(side => side.toUpperCase() + ': ' + manifest.sources[side].name + '\nSHA-256: ' + manifest.sources[side].sha256).join('\n\n');
    downloadUrl = URL.createObjectURL(new Blob([RowCheck.zip(report.files)], {type: 'application/zip'}));
    $('download').disabled = false; $('results').hidden = false;
  }
  $('compare').addEventListener('click', async () => {
    if (!(left && right && $('key').value)) return;
    invalidate(); const token = generation; $('compare').disabled = true; status('Comparing and hashing the report on this device…');
    try {
      const result = await RowCheck.makeReport(left, right, $('key').value, chosenColumns(), delimiter());
      if (token !== generation) return;
      report = result; showReport(); status('Comparison complete. Review the results or download the report.');
    } catch (error) { if (token === generation) showError(error); }
    finally { if (token === generation) $('compare').disabled = false; }
  });
  $('key').addEventListener('change', () => { invalidate(); makeColumns(); status('Choose value columns if needed, then compare files.'); });
  $('left-file').addEventListener('change', () => { exampleBytes = null; loadFiles(); });
  $('right-file').addEventListener('change', () => { exampleBytes = null; loadFiles(); });
  $('delimiter').addEventListener('change', () => loadFiles(Boolean(exampleBytes)));
  $('preview-file').addEventListener('change', preview);
  $('download').addEventListener('click', () => {
    if (!downloadUrl) return;
    const link = document.createElement('a'); link.href = downloadUrl; link.download = 'rowcheck-report.zip'; link.click();
  });
  $('reset').addEventListener('click', () => {
    left = right = null; exampleBytes = null; $('left-file').value = ''; $('right-file').value = ''; invalidate(); resetRules();
    $('left-name').textContent = $('right-name').textContent = 'No file selected'; status('Selections and report cleared. Choose two CSV files, or try the example.');
  });
  $('example').addEventListener('click', () => {
    $('left-file').value = ''; $('right-file').value = ''; $('delimiter').value = ',';
    exampleBytes = [new File([/* ROWCHECK_EXAMPLE_LEFT */], 'catalog-left.csv', {type: 'text/csv'}), new File([/* ROWCHECK_EXAMPLE_RIGHT */], 'catalog-right.csv', {type: 'text/csv'})];
    loadFiles(true);
  });
})();
