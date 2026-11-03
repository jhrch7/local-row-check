#!/usr/bin/env node
/* Actual local-file/project-site UI verification in a NEW headless profile.
 * No existing browser/profile, Safari surface or account is used.
 * Usage: node browser/check_ui.cjs --chrome PATH --work-dir NEW_DIRECTORY
 * Optional: --site-url https://jhrch7.github.io/local-row-check/
 * Local landing review: --site-url local --visual-only
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--chrome') || !args.includes('--work-dir')) throw new Error('Provide --chrome and a NEW --work-dir.');
const work = path.resolve(option('--work-dir')), root = path.resolve(__dirname, '..');
const site = args.includes('--site-url') ? option('--site-url') : null;
const visualOnly = args.includes('--visual-only');
assert.ok(!visualOnly || site, '--visual-only needs a project landing page');
assert.ok(!site || site === 'local' || site === 'https://jhrch7.github.io/local-row-check/', 'Use this project site or its local landing file only');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await fs.mkdir(work);
  const profile = path.join(work, 'chrome-profile'), downloads = path.join(work, 'downloads');
  await fs.mkdir(profile); await fs.mkdir(downloads);
  const child = spawn(option('--chrome'), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = '', socket, endpoint, session, nextId = 0;
  const pending = new Map(), requests = [], requestMethods = [], exceptions = [], checks = [];
  child.stderr.on('data', data => { stderr += data; const match = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/\S+)/); if (match) endpoint = match[1]; });
  function rpc(method, params = {}, page = true) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 12000);
      pending.set(id, {resolve, reject, timer});
      socket.send(JSON.stringify({id, method, params, ...(page && session ? {sessionId: session} : {})}));
    });
  }
  async function evaluate(expression) {
    const out = await rpc('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
    return out.result.value;
  }
  async function until(expression, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(30); }
    throw new Error('UI condition timed out: ' + label);
  }
  async function upload(selector, file) {
    const doc = await rpc('DOM.getDocument');
    const found = await rpc('DOM.querySelector', {nodeId: doc.root.nodeId, selector});
    assert.ok(found.nodeId, selector);
    await rpc('DOM.setFileInputFiles', {nodeId: found.nodeId, files: [file]});
  }
  async function capture(name) {
    const result = await rpc('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
    await fs.writeFile(path.join(work, name), Buffer.from(result.data, 'base64'));
  }
  let receipt;
  try {
    for (let i = 0; i < 300 && !endpoint; i++) { if (child.exitCode !== null) throw new Error('Chrome exited: ' + stderr); await delay(100); }
    assert.ok(endpoint, 'Own Chrome DevTools endpoint was not created');
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer);
        if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result);
      }
      if (data.method === 'Network.requestWillBeSent') {
        requestMethods.push(data.params.request.method);
        requests.push(data.params.request.url);
      }
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails);
    });
    const version = await rpc('Browser.getVersion', {}, false);
    const target = await rpc('Target.createTarget', {url: 'about:blank'}, false);
    session = (await rpc('Target.attachToTarget', {targetId: target.targetId, flatten: true}, false)).sessionId;
    await rpc('Page.enable'); await rpc('Runtime.enable'); await rpc('Network.enable');
    await rpc('Emulation.setDeviceMetricsOverride', {width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false});
    await rpc('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloads}, false);
    const app = path.join(root, 'rowcheck-offline.html');
    if (site) {
      await rpc('Page.navigate', {url: site === 'local' ? pathToFileURL(path.join(root, 'docs/index.html')).href : site});
      await until("document.readyState==='complete' && document.getElementById('open-tool') && document.images[0].complete && document.images[0].naturalWidth===1060", 'project landing and actual preview load');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await capture('landing-desktop.png');
      await rpc('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await capture('landing-narrow.png');
      checks.push('actual project landing, image, resource links and 390px layout load');
      await rpc('Emulation.setDeviceMetricsOverride', {width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false});
      if (visualOnly) {
        assert.ok(requestMethods.every(method => method === 'GET'), 'Project UI must not upload data');
        assert.deepEqual(exceptions, []);
        const visual = {state: 'passed_visual_only', browser: version.product, checks, networkRequests: requests, SafariUsed: false};
        await fs.writeFile(path.join(work, 'ui-results.json'), JSON.stringify(visual, null, 2) + '\n');
        console.log(JSON.stringify(visual, null, 2));
        return;
      }
      await evaluate("document.getElementById('download-tool').click()");
      for (let i = 0; i < 200; i++) { if (await fs.stat(path.join(downloads, 'rowcheck-offline.html')).catch(() => null)) break; await delay(50); }
      assert.deepEqual(await fs.readFile(path.join(downloads, 'rowcheck-offline.html')), await fs.readFile(app));
      checks.push('landing download returns the exact unchanged standalone HTML');
      await evaluate("document.getElementById('open-tool').click()");
    } else {
      await rpc('Page.navigate', {url: pathToFileURL(app).href});
    }
    await until("document.readyState === 'complete' && typeof RowCheck === 'object'", 'app loads');
    assert.deepEqual(await evaluate("({keyDisabled:document.getElementById('key').disabled, compareDisabled:document.getElementById('compare').disabled, resultsHidden:document.getElementById('results').hidden})"), {keyDisabled: true, compareDisabled: true, resultsHidden: true});
    checks.push('actual offline file loads, with deliberate key selection and no stale report');

    await evaluate("document.getElementById('example').click()");
    await until("document.getElementById('key').value === 'SKU' && !document.getElementById('compare').disabled", 'example loaded');
    assert.match(await evaluate("document.getElementById('left-name').textContent"), /^Included example:/);
    await evaluate("document.getElementById('compare').click()");
    await until("!document.getElementById('results').hidden", 'example comparison');
    const golden = JSON.parse(await fs.readFile(path.join(root, 'examples/catalog/report/manifest.json'), 'utf8'));
    const shown = await evaluate("[...document.querySelectorAll('#counts tr')].map(tr=>[...tr.children].slice(1).map(td=>Number(td.textContent)))");
    assert.deepEqual(shown, ['left', 'right'].map(side => Object.values(golden.counts[side])));
    assert.match(await evaluate("document.getElementById('value-summary').textContent"), /3 changed cells/);
    checks.push('included example shows the published Python fixture counts and three changed cells');
    await capture('desktop.png');
    const resultBox = await evaluate("(()=>{const r=document.getElementById('results').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()");
    const resultCapture = await rpc('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: resultBox});
    await fs.writeFile(path.join(work, 'results.png'), Buffer.from(resultCapture.data, 'base64'));

    await evaluate("document.getElementById('download').click()");
    for (let i = 0; i < 100; i++) { if (await fs.stat(path.join(downloads, 'rowcheck-report.zip')).catch(() => null)) break; await delay(50); }
    const zip = await fs.readFile(path.join(downloads, 'rowcheck-report.zip'));
    assert.ok(zip.length > 1000);
    checks.push('actual report ZIP downloaded through the browser button');

    await evaluate("document.getElementById('preview-file').value='review.csv';document.getElementById('preview-file').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelectorAll('#preview tbody tr').length"), 4);
    await evaluate("const checkbox=document.querySelector('#column-options input');checkbox.checked=!checkbox.checked;checkbox.dispatchEvent(new Event('change'))");
    assert.deepEqual(await evaluate("({hidden:document.getElementById('results').hidden, disabled:document.getElementById('download').disabled, rows:document.querySelectorAll('#counts tr').length})"), {hidden: true, disabled: true, rows: 0});
    checks.push('review preview retains all ambiguous fixture rows; changed options invalidate old results/download');

    const leftSemi = path.join(work, 'left-semicolon.csv'), rightSemi = path.join(work, 'right-semicolon.csv'), bad = path.join(work, 'ragged.csv');
    await fs.writeFile(leftSemi, 'ID;V\na;"old;value"\n');
    await fs.writeFile(rightSemi, 'ID;V\na;new\nb;next\n');
    await fs.writeFile(bad, 'ID;V\na\n');
    await evaluate("document.getElementById('reset').click();document.getElementById('delimiter').value=';';document.getElementById('delimiter').dispatchEvent(new Event('change'))");
    await upload('#left-file', leftSemi); await upload('#right-file', rightSemi);
    await until("!document.getElementById('key').disabled", 'actual file inputs parsed');
    await evaluate("document.getElementById('key').value='ID';document.getElementById('key').dispatchEvent(new Event('change'));const value=document.querySelector('#column-options input');value.checked=true;value.dispatchEvent(new Event('change'));document.getElementById('compare').click()");
    await until("!document.getElementById('results').hidden", 'semicolon report');
    assert.match(await evaluate("document.getElementById('value-summary').textContent"), /1 changed cell\b/);
    assert.equal(await evaluate("document.querySelector('#preview tbody td:nth-child(5)').textContent"), 'old;value');
    checks.push('real local-file selection, semicolon parsing and selected-value preview work');
    await upload('#left-file', bad);
    await until("!document.getElementById('error').hidden", 'ragged input rejected');
    assert.match(await evaluate("document.getElementById('error').textContent"), /expected 2/);
    assert.equal(await evaluate("document.getElementById('results').hidden && document.getElementById('compare').disabled && document.getElementById('download').disabled && document.getElementById('hashes').textContent === ''"), true);
    checks.push('invalid replacement file removes the old report and prevents stale download');

    await evaluate("document.getElementById('reset').click();document.getElementById('delimiter').value=',';window.originalArrayBuffer=File.prototype.arrayBuffer;window.releaseReads=[];File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseReads.push(()=>resolve(window.originalArrayBuffer.call(this))))}");
    await upload('#left-file', path.join(root, 'examples/catalog/left.csv'));
    await upload('#right-file', path.join(root, 'examples/catalog/right.csv'));
    await until('window.releaseReads.length >= 2', 'delayed file reads pending');
    await evaluate("document.getElementById('reset').click();for(const release of window.releaseReads)release();File.prototype.arrayBuffer=window.originalArrayBuffer");
    await delay(100);
    assert.equal(await evaluate("document.getElementById('key').disabled && document.getElementById('results').hidden && document.getElementById('left-name').textContent === 'No file selected'"), true);
    checks.push('clearing while reads are pending cannot restore earlier inputs/results');

    await evaluate("document.getElementById('example').click()");
    await until("document.getElementById('key').value === 'SKU' && !document.getElementById('compare').disabled", 'example restored');
    await evaluate("document.getElementById('compare').click()");
    await until("!document.getElementById('results').hidden", 'results restored');
    await rpc('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await capture('narrow.png');
    checks.push('390px viewport has no whole-page horizontal overflow; report table scroll remains local');
    await rpc('Page.reload');
    await until("document.readyState==='complete' && document.getElementById('key').disabled", 'fresh reload');
    assert.equal(await evaluate("document.getElementById('left-file').files.length === 0 && document.getElementById('right-file').files.length === 0 && document.getElementById('results').hidden"), true);
    const external = requests.filter(url => /^https?:/.test(url));
    assert.ok(requestMethods.every(method => method === 'GET'), 'Project UI must not upload data');
    if (site && site !== 'local') {
      const allowed = new Set([site, site + 'compare.html', site + 'offline-example.png', site + 'favicon.ico', 'https://jhrch7.github.io/favicon.ico']);
      assert.ok(external.every(url => allowed.has(url)), 'Only the declared project resources may be requested');
    } else {
      assert.deepEqual(external, []);
    }
    assert.deepEqual(exceptions, []);
    checks.push('reload starts empty; only declared project GET resources and no uncaught browser exceptions observed');
    receipt = {state: 'passed', browser: version.product, userAgent: version.userAgent, siteUrl: site, appSha256: createHash('sha256').update(await fs.readFile(app)).digest('hex'), checks, networkRequests: requests, requestMethods, externalHttpRequests: external, downloadedZipBytes: zip.length, downloadedZipSha256: createHash('sha256').update(zip).digest('hex'), profile: 'New isolated headless profile only; removed after process exit', SafariUsed: false};
    await fs.writeFile(path.join(work, 'ui-results.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await rpc('Browser.close', {}, false); } catch {} socket.close(); }
    for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(50);
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    await fs.writeFile(path.join(work, 'chrome.stderr.log'), stderr);
    await fs.rm(profile, {recursive: true});
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
