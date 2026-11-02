// PROTOTYPE (issue 12): turn saved HTML into plain article text with Readability, as the Garden would on the Mac.
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
const [,, inFile, url, outFile] = process.argv;
const dom = new JSDOM(fs.readFileSync(inFile, 'utf8'), { url, virtualConsole: new VirtualConsole() });
const a = new Readability(dom.window.document).parse();
const text = (a?.textContent || '').replace(/\n\s*\n+/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
fs.writeFileSync(outFile, JSON.stringify({ url, title: a?.title, byline: a?.byline, site: a?.siteName, published: a?.publishedTime, text }, null, 1));
console.log(outFile.split('/').pop(), (a?.title || '').slice(0, 70), '|', text.length, 'chars');
