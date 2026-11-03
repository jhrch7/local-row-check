/* Local Row Check browser core. MIT licence; no network or dependencies. */
(function (root) {
  'use strict';
  const VERSION = '1.3.0';
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_RECORDS = 50000;
  // Python str.isspace(), used by the existing CLI for blank keys and safety prefixes.
  const SPACE = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const blank = new RegExp('^' + SPACE + '*$');
  const leadingSpace = new RegExp('^' + SPACE + '*');
  const encode = value => new TextEncoder().encode(value);

  function parseCsv(text, delimiter = ',', name = 'CSV') {
    if (![',', ';', '\t'].includes(delimiter)) throw new Error('Choose comma, semicolon or tab.');
    const rows = [];
    let row = [], field = '', state = 'start', active = false;
    const endField = () => { row.push(field); field = ''; state = 'start'; };
    const endRow = () => {
      if (active) endField();
      rows.push(row); row = []; active = false; state = 'start';
      if (rows.length > MAX_RECORDS + 1) throw new Error(name + ': more than 50,000 data records.');
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\0') throw new Error(name + ': NUL characters are unsupported.');
      if (state === 'quoted') {
        if (ch === '"') state = 'closed'; else field += ch;
      } else if (state === 'closed' && ch === '"') {
        field += '"'; state = 'quoted';
      } else if (ch === delimiter) {
        endField(); active = true;
      } else if (ch === '\r' || ch === '\n') {
        endRow();
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else if (state === 'closed') {
        throw new Error(name + ': unexpected text after a closing quote.');
      } else if (state === 'start' && ch === '"') {
        state = 'quoted'; active = true;
      } else {
        field += ch; state = 'plain'; active = true;
      }
    }
    if (state === 'quoted') throw new Error(name + ': quoted field is not closed.');
    if (active) endRow();
    if (!rows.length) throw new Error(name + ': empty file.');
    const columns = rows[0];
    if (!columns.length || columns.some(h => blank.test(h)) || new Set(columns).size !== columns.length) {
      throw new Error(name + ': headers must be nonempty and unique.');
    }
    const records = rows.slice(1).map((cells, index) => {
      if (cells.length !== columns.length) {
        throw new Error(name + ': data record ' + (index + 1) + ' has ' + cells.length + ' fields; expected ' + columns.length + '.');
      }
      return {number: index + 1, cells, row: Object.fromEntries(columns.map((column, i) => [column, cells[i]]))};
    });
    return {name, columns, records};
  }

  async function sha256(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error('Local hashing is unavailable in this browser. Use a current Chromium browser or the Python CLI.');
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function readBytes(raw, name, delimiter = ',') {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.length > MAX_BYTES) throw new Error(name + ': the browser edition accepts up to 2 MiB per file.');
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch { throw new Error(name + ': not valid UTF-8. Export as UTF-8 CSV or use the CLI with its actual encoding.'); }
    const data = parseCsv(text, delimiter, name);
    return {...data, bytes: bytes.length, sha256: await sha256(bytes)};
  }

  function codePointOrder(a, b) {
    const left = Array.from(a), right = Array.from(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
      if (diff) return diff;
    }
    return left.length - right.length;
  }

  function keyColumns(key) {
    const keys = typeof key === 'string' ? [key] : key;
    if (!Array.isArray(keys) || !keys.length || keys.some(c => typeof c !== 'string' || !c)) throw new Error('Choose at least one key column.');
    if (new Set(keys).size !== keys.length) throw new Error('Choose unique key columns.');
    return keys;
  }

  function compare(left, right, key, columns = []) {
    const keyCols = keyColumns(key), compound = keyCols.length > 1, keyParts = new Map();
    for (const data of [left, right]) {
      if (keyCols.some(c => !data.columns.includes(c))) throw new Error(data.name + ': choose key columns present in both files.');
      if (columns.some(c => !data.columns.includes(c))) throw new Error(data.name + ': a selected value column is missing.');
    }
    if (new Set(columns).size !== columns.length || keyCols.some(c => columns.includes(c))) throw new Error('Choose unique non-key value columns.');
    const groups = {left: new Map(), right: new Map()};
    const only = {left: [], right: []}, review = [], shared = [], changes = [];
    for (const [side, data] of [['left', left], ['right', right]]) {
      for (const record of data.records) {
        const parts = keyCols.map(c => record.row[c]);
        const value = compound ? JSON.stringify(parts) : parts[0];
        if (parts.some(part => blank.test(part))) review.push({side, record, reason: 'blank key', value});
        else {
          if (compound) keyParts.set(value, parts);
          if (!groups[side].has(value)) groups[side].set(value, []);
          groups[side].get(value).push(record);
        }
      }
    }
    const order = compound ? (a, b) => {
      const x = keyParts.get(a), y = keyParts.get(b);
      for (let i = 0; i < keyCols.length; i++) { const diff = codePointOrder(x[i], y[i]); if (diff) return diff; }
      return 0;
    } : codePointOrder;
    const keys = [...new Set([...groups.left.keys(), ...groups.right.keys()])].sort(order);
    for (const value of keys) {
      const a = groups.left.get(value) || [], b = groups.right.get(value) || [];
      if (a.length > 1 || b.length > 1) {
        for (const [side, records] of [['left', a], ['right', b]]) {
          for (const record of records) review.push({side, record, reason: 'duplicate comparison key', value});
        }
      } else if (a.length && b.length) {
        shared.push([value, a[0].number, b[0].number, value, value]);
        for (const column of columns) {
          if (a[0].row[column] !== b[0].row[column]) changes.push([value, a[0].number, b[0].number, column, a[0].row[column], b[0].row[column]]);
        }
      } else {
        const side = a.length ? 'left' : 'right';
        only[side].push({value, record: (a.length ? a : b)[0]});
      }
    }
    const counts = {};
    for (const [side, data] of [['left', left], ['right', right]]) {
      counts[side] = {input: data.records.length, only: only[side].length, shared: shared.length, review: review.filter(r => r.side === side).length};
      const c = counts[side];
      if (c.input !== c.only + c.shared + c.review) throw new Error('Row-accounting check failed. No report was created.');
    }
    return {only, review, shared, changes, counts};
  }

  async function makeReport(left, right, key, columns = [], delimiter = ',') {
    const keys = keyColumns(key);
    const result = compare(left, right, key, columns);
    const files = {}, tables = {}, metadata = {};
    let escaped = 0;
    const safe = value => {
      const text = String(value), lead = text.replace(leadingSpace, '');
      if (/^[\t\r\n]/.test(text) || /^[=+\-@]/.test(lead)) { escaped++; return "'" + text; }
      return text;
    };
    const csvCell = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    const csv = (name, rows) => {
      tables[name] = rows;
      const lines = rows.map(row => row.map(v => csvCell(safe(v))).join(','));
      files[name] = '\ufeff' + lines.join('\n') + '\n';
    };
    for (const [side, data] of [['left', left], ['right', right]]) {
      let recordCol = '__source_record__', keyCol = '__comparison_key__';
      while (data.columns.includes(recordCol)) recordCol += '_';
      while (data.columns.includes(keyCol) || keyCol === recordCol) keyCol += '_';
      metadata[side] = [recordCol, keyCol];
      csv('only_' + side + '.csv', [[recordCol, keyCol, ...data.columns], ...result.only[side].map(r => [r.record.number, r.value, ...r.record.cells])]);
    }
    const originalJson = (data, record) => '{' + data.columns.map((column, i) => JSON.stringify(column) + ': ' + JSON.stringify(record.cells[i])).join(', ') + '}';
    csv('review.csv', [['source', 'source_record', 'reason', 'comparison_key', 'original_row_json'], ...result.review.map(r => [r.side, r.record.number, r.reason, r.value, originalJson(r.side === 'left' ? left : right, r.record)])]);
    csv('shared_keys.csv', [['comparison_key', 'left_source_record', 'right_source_record', 'left_original_key', 'right_original_key'], ...result.shared]);
    if (columns.length) csv('value_changes.csv', [['comparison_key', 'left_source_record', 'right_source_record', 'column', 'left_value', 'right_value'], ...result.changes]);
    const outputs = {};
    for (const [name, text] of Object.entries(files)) {
      const bytes = encode(text); outputs[name] = {sha256: await sha256(bytes), bytes: bytes.length};
    }
    const manifest = {
      version: VERSION, edition: 'offline-browser', key: keys.length === 1 ? keys[0] : keys, normalisation: 'none', input_delimiter: delimiter, input_encoding: 'utf-8-sig',
      source_record_definition: '1-based CSV data record, excluding the header; not a physical line number',
      sources: Object.fromEntries([['left', left], ['right', right]].map(([side, data]) => [side, {name: data.name, sha256: data.sha256, bytes: data.bytes, columns: data.columns}])),
      counts: result.counts, formula_like_csv_cells_prefixed_with_apostrophe: escaped, metadata_columns: metadata, outputs,
      limits: ['Shared keys do not prove two rows refer to the same person.', 'No fuzzy matching, enrichment or correction is performed.', 'Original input files are the authoritative source of original cell values.', 'Reports contain your data; keep them private.', 'Browser edition: exact keys only, UTF-8, up to 2 MiB and 50,000 data records per input.']
    };
    if (keys.length > 1) {
      manifest.key_columns = keys;
      manifest.comparison_key_encoding = 'Compact JSON array of strings in key_columns order; original keys use the same encoding.';
    }
    if (columns.length) {
      const changedKeys = new Set(result.changes.map(row => row[0])).size;
      manifest.value_comparison = {columns, method: 'Exact decoded strings; key normalisation is not applied to these values.', shared_keys_compared: result.shared.length, keys_with_changes: changedKeys, keys_without_selected_changes: result.shared.length - changedKeys, changed_cells: result.changes.length};
    }
    files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
    return {files, tables, manifest};
  }

  const crcTable = Array.from({length: 256}, (_, i) => {
    let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  function zip(files) {
    const local = [], central = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      if (!/^[a-z_]+\.(csv|json)$/.test(name)) throw new Error('Unexpected report filename.');
      const filename = encode(name), bytes = encode(text);
      let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
      const header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, filename.length, true); header.set(filename, 30);
      const entry = new Uint8Array(46 + filename.length), e = new DataView(entry.buffer);
      e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x800, true); e.setUint16(14, 33, true);
      e.setUint32(16, crc, true); e.setUint32(20, bytes.length, true); e.setUint32(24, bytes.length, true); e.setUint16(28, filename.length, true); e.setUint32(42, offset, true); entry.set(filename, 46);
      local.push(header, bytes); central.push(entry); offset += header.length + bytes.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centralSize + end.length); let cursor = 0;
    for (const part of [...local, ...central, end]) { out.set(part, cursor); cursor += part.length; }
    return out;
  }
  const api = {VERSION, MAX_BYTES, MAX_RECORDS, parseCsv, readBytes, compare, makeReport, zip};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RowCheck = api;
})(globalThis);
