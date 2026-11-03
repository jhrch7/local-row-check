'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./core.js');
const bytes = text => new TextEncoder().encode(text);

test('CSV parser preserves quoted delimiters, embedded CRLF and literal unquoted quotes', () => {
  const data = R.parseCsv('ID,Value\r\n1,"a,b\r\nc"\r\n2,a"b\r\n');
  assert.deepEqual(data.records.map(r => r.cells), [['1', 'a,b\r\nc'], ['2', 'a"b']]);
  assert.deepEqual(data.records.map(r => r.number), [1, 2]);
});

test('invalid CSV fails instead of dropping or repairing records', async () => {
  for (const csv of ['ID,V\na\n', 'ID,V\n\n', 'ID,ID\n1,2\n', 'ID,V\n1,"x', 'ID,V\n1,"x"oops\n', 'ID,V\n1,\0\n']) {
    assert.throws(() => R.parseCsv(csv));
  }
  await assert.rejects(R.readBytes(Uint8Array.of(0xff), 'bad.csv'), /UTF-8/);
});

test('entire duplicate group on both sides is withheld from value matching', async () => {
  const left = await R.readBytes(bytes('ID,V\na,1\na,2\nb,3\n,4\n'), 'left.csv');
  const right = await R.readBytes(bytes('ID,V\na,99\nb,03\nc,4\n'), 'right.csv');
  const r = await R.makeReport(left, right, 'ID', ['V']);
  assert.deepEqual(r.manifest.counts, {left: {input: 4, only: 0, shared: 1, review: 3}, right: {input: 3, only: 1, shared: 1, review: 1}});
  assert.equal(r.manifest.value_comparison.changed_cells, 1);
  assert.deepEqual(r.tables['value_changes.csv'][1], ['b', 3, 2, 'V', '3', '03']);
});

test('exact keys keep spaces/case; Python whitespace-only keys require review', async () => {
  const left = await R.readBytes(bytes('ID\na\nA\n a\n\u0085\n\ufeff\n'), 'left.csv');
  const right = await R.readBytes(bytes('ID\na\n'), 'right.csv');
  const result = R.compare(left, right, 'ID');
  assert.equal(result.review.length, 1);
  assert.equal(result.review[0].record.number, 4);
  assert.equal(result.only.left.length, 3);
});

test('selected values only; formula prefixes and source/output hashes are recorded', async () => {
  const left = await R.readBytes(bytes('ID,Price,Ignored\nx,20.00,old\ny,=1+1,keep\n'), 'left.csv');
  const right = await R.readBytes(bytes('ID,Price,Ignored\nx,20.0,new\ny,+2,keep\n'), 'right.csv');
  const r = await R.makeReport(left, right, 'ID', ['Price']);
  assert.equal(r.manifest.value_comparison.changed_cells, 2);
  assert.equal(r.manifest.formula_like_csv_cells_prefixed_with_apostrophe, 2);
  assert.ok(r.files['value_changes.csv'].includes("'=1+1,'+2"));
  assert.match(r.manifest.sources.left.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.manifest.outputs['value_changes.csv'].bytes, bytes(r.files['value_changes.csv']).length);
});

test('browser resource bounds are explicit and enforced', async () => {
  await assert.rejects(R.readBytes(new Uint8Array(R.MAX_BYTES + 1), 'large.csv'), /2 MiB/);
  assert.throws(() => R.parseCsv('ID\n' + 'a\n'.repeat(R.MAX_RECORDS + 1)), /50,000/);
});

test('unsafe option choices fail; key-only report stays key-only', async () => {
  const data = await R.readBytes(bytes('ID,V\na,1\n'), 'input.csv');
  assert.throws(() => R.compare(data, data, 'missing'));
  assert.throws(() => R.compare(data, data, 'ID', ['ID']));
  assert.throws(() => R.compare(data, data, 'ID', ['V', 'V']));
  const r = await R.makeReport(data, data, 'ID');
  assert.equal('value_changes.csv' in r.files, false);
  assert.equal('value_comparison' in r.manifest, false);
});
