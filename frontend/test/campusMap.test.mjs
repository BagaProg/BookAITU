import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

test('all campus floors render and room codes distinguish blocks', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { default: CampusMap, mapCode } = await server.ssrLoadModule('/src/components/CampusMap.jsx');
    assert.equal(mapCode({ block: 'C1.1', number: '221p' }), 'C1.1.221P');
    assert.notEqual(mapCode({ block: 'C1.1', number: '221' }), mapCode({ block: 'C1.2', number: '221' }));
    for (const floor of [1, 2, 3]) {
      const { default: Plan } = await server.ssrLoadModule(`/src/components/campus/C1_ALL_${floor}.jsx`);
      const html = renderToStaticMarkup(createElement(Plan));
      assert.match(html, /<svg[^>]+viewBox=/);
      assert.match(html, /data-name="C1\.[123]\./);
      assert.match(html, /map-groups-wcs-icon/);
    }
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CampusMap, {
      rooms: [], slot: { date: '2026-11-09', start: '09:00', end: '10:00' }, checkedAt: '2026-11-09T04:00:00Z',
    })));
    assert.match(html, /2026-11-09/);
    assert.match(html, /09:00.*10:00/);
    assert.match(html, /Grey rooms have no matching inventory record/);
    assert.match(html, /MIT License/);
  } finally {
    await server.close();
  }
});
