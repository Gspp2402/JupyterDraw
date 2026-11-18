import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imageExtensions = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp']);

function posixPath(value) {
  return value.split(path.sep).join('/');
}

async function walk(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function allStrings(value, strings = []) {
  if (typeof value === 'string') strings.push(value);
  else if (Array.isArray(value)) value.forEach(item => allStrings(item, strings));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => allStrings(item, strings));
  return strings;
}

function referencesImage(strings, notebookPath, imagePath) {
  const relative = posixPath(path.relative(path.dirname(notebookPath), imagePath));
  const variants = new Set([
    relative,
    relative.replace(/^\.\//, ''),
    posixPath(imagePath),
    encodeURI(relative),
    encodeURI(relative.replace(/^\.\//, '')),
    pathToFileURL(imagePath).href
  ]);
  return strings.some(value => {
    let decoded = value;
    try { decoded = decodeURI(value); } catch {}
    return [...variants].some(reference => value.includes(reference) || decoded.includes(reference));
  });
}

export async function findUnusedImages(directory) {
  const root = path.resolve(directory);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`${root} non è una directory`);
  const files = await walk(root);
  const notebookFiles = files.filter(file => path.extname(file).toLowerCase() === '.ipynb');
  if (!notebookFiles.length) throw new Error(`Nessun notebook trovato in ${root}`);
  const notebooks = [];
  for (const notebookPath of notebookFiles) {
    let notebook;
    try {
      notebook = JSON.parse(await readFile(notebookPath, 'utf8'));
    } catch (error) {
      throw new Error(`Impossibile leggere ${path.relative(root, notebookPath)}: ${error.message}`);
    }
    notebooks.push({ path: notebookPath, strings: allStrings(notebook) });
  }
  const images = files
    .filter(file => posixPath(path.relative(root, file)).split('/').includes('Images'))
    .filter(file => imageExtensions.has(path.extname(file).toLowerCase()))
    .map(file => ({ path: file, name: path.basename(file) }));
  const unused = images.filter(image => !notebooks.some(notebook => referencesImage(notebook.strings, notebook.path, image.path)));
  return { root, notebooks: notebookFiles, images, unused };
}

export async function cleanupUnusedImages(directory, { apply = false } = {}) {
  const result = await findUnusedImages(directory);
  if (apply) await Promise.all(result.unused.map(image => rm(image.path)));
  return result;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const directory = argumentsList.find(argument => !argument.startsWith('-'));
  const apply = argumentsList.includes('--apply');
  const unknown = argumentsList.filter(argument => argument !== directory && argument !== '--apply');
  if (!directory || unknown.length) throw new Error('Uso: node scripts/clean-images.mjs <directory> [--apply]');
  const result = await cleanupUnusedImages(directory, { apply });
  console.log(`Notebook letti: ${result.notebooks.length}`);
  console.log(`Immagini in Images: ${result.images.length}`);
  console.log(`${apply ? 'Eliminate' : 'Non referenziate'}: ${result.unused.length}`);
  for (const image of result.unused) console.log(`  ${path.relative(result.root, image.path)}`);
  if (result.unused.length && !apply) console.log('Dry-run: riesegui aggiungendo --apply per eliminare questi file.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
