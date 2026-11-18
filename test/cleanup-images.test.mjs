import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupUnusedImages, findUnusedImages } from '../scripts/clean-images.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jupyter-draw-cleanup-'));
  await mkdir(join(root, 'Images'));
  await Promise.all([
    writeFile(join(root, 'lesson-a.ipynb'), JSON.stringify({ cells: [{ source: '![Disegno](Images/jupyter-draw-a.png)' }] })),
    writeFile(join(root, 'lesson-b.ipynb'), JSON.stringify({ cells: [{ source: '<img src="Images/diagram one.svg">' }, { source: '![plot](Images/plot%20one.png)' }] })),
    writeFile(join(root, 'Images', 'jupyter-draw-a.png'), 'generated'),
    writeFile(join(root, 'Images', 'diagram one.svg'), 'referenced'),
    writeFile(join(root, 'Images', 'plot one.png'), 'encoded'),
    writeFile(join(root, 'Images', 'unused.png'), 'unused')
  ]);
  return root;
}

test('finds only Images files not referenced by any notebook in the directory', async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await findUnusedImages(root);
  assert.equal(result.notebooks.length, 2);
  assert.equal(result.images.length, 4);
  assert.deepEqual(result.unused.map(file => file.name), ['unused.png']);
});

test('dry-run preserves files and apply removes only the unused image', async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await cleanupUnusedImages(root, { apply: false });
  assert.equal(await readFile(join(root, 'Images', 'unused.png'), 'utf8'), 'unused');
  const result = await cleanupUnusedImages(root, { apply: true });
  await assert.rejects(readFile(join(root, 'Images', 'unused.png')));
  assert.equal(await readFile(join(root, 'Images', 'jupyter-draw-a.png'), 'utf8'), 'generated');
  assert.deepEqual(result.unused.map(file => file.name), ['unused.png']);
});

test('refuses to classify files when a notebook is malformed', async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'broken.ipynb'), '{broken');
  await assert.rejects(findUnusedImages(root), /broken\.ipynb/);
  assert.equal(await readFile(join(root, 'Images', 'unused.png'), 'utf8'), 'unused');
});

test('refuses to clean Images when the directory has no notebooks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jupyter-draw-cleanup-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Images'));
  await writeFile(join(root, 'Images', 'image.png'), 'keep');
  await assert.rejects(findUnusedImages(root), /Nessun notebook/);
  assert.equal(await readFile(join(root, 'Images', 'image.png'), 'utf8'), 'keep');
});
