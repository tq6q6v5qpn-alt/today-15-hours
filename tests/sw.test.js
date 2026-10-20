const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('서비스워커 갱신은 확인한 이전 캐시만 지우고 다른 앱과 알 수 없는 캐시를 보존한다', async () => {
  const handlers = {};
  const entries = new Map([
    ['today15-v18', 'known retired assets'],
    ['today15-v19', 'current assets'],
    ['other-project-offline-v1', 'synthetic offline-only document'],
    ['today15-v17', 'unconfirmed older cache'],
    ['today15-v999', 'unknown future cache'],
    ['today15-v18-extra', 'similar name owned elsewhere'],
    ['today15-custom', 'unknown custom cache']
  ]);
  const retained = new Map([...entries].filter(([key]) => key !== 'today15-v18'));
  const deleted = [];
  let claimed = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    self: {
      addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: { claim: async () => { claimed++; } }
    },
    caches: {
      keys: async () => [...entries.keys()],
      delete: async key => { deleted.push(key); return entries.delete(key); }
    }
  });
  for (let activation = 0; activation < 2; activation++) {
    let finished;
    handlers.activate({ waitUntil: promise => { finished = promise; } });
    await finished;
    assert.deepEqual(entries, retained, 'retained cache payloads must remain unchanged');
  }
  assert.deepEqual(deleted, ['today15-v18']);
  assert.equal(claimed, 2);
});

test('오프라인 자산과 탐색 대체 화면은 현재 앱 캐시에서만 읽는다', async () => {
  const handlers = {};
  const opened = [];
  const cache = {
    match: async request => typeof request === 'string' ? 'current app shell'
      : request.mode === 'navigate' ? undefined : 'current app module'
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async () => { throw new Error('synthetic offline network'); },
    caches: {
      open: async name => { opened.push(name); return cache; },
      match: async () => 'stale same-URL response from another cache'
    }
  });
  for (const [mode, expected] of [['cors', 'current app module'], ['navigate', 'current app shell']]) {
    let response;
    handlers.fetch({ request: { method: 'GET', mode }, respondWith: promise => { response = promise; } });
    assert.equal(await response, expected);
  }
  assert.deepEqual(opened, ['today15-v19', 'today15-v19']);
});
