import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { decodeUpload } from '../apps/backend/src/images.js';
const url = (svg: string) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
test('safe vector logo becomes a local raster without active SVG content', async () => {
  const png = await decodeUpload(url('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0h32v32H0Z" fill="#ff4658"/></svg>'));
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  const meta = await sharp(png).metadata(); assert.equal(meta.width, 32); assert.equal(meta.height, 32);
});
test('SVG external references, scripts, entity expansion and foreignObject are rejected before rendering', async () => {
  for (const body of ['<script>alert(1)</script>', '<image href="file:///C:/secret.png"/>', '<foreignObject><iframe/></foreignObject>', '<path onload="alert(1)"/>', '<path fill="url(https://example.com/private)"/>', '<style>@import "https://example.com";</style>', '<use href="#loop" id="loop"/>']) {
    await assert.rejects(() => decodeUpload(url(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${body}</svg>`)));
  }
  await assert.rejects(() => decodeUpload(url('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///C:/secret">]><svg>&x;</svg>')));
});
test('corrupt raster files and oversized images are rejected by the image decoder', async () => {
  await assert.rejects(() => decodeUpload('data:image/png;base64,' + Buffer.from('not an image').toString('base64')));
  await assert.rejects(() => decodeUpload(url('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000"><rect width="100%" height="100%"/></svg>')));
});
