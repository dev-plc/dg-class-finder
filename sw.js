// Service Worker — 앱 코드는 네트워크 우선, 이미지만 캐시 우선.
//
// 목적은 "열면 항상 최신"이다. 옛 코드가 계속 나오는 일을 없애려고
// 세 겹 중 첫 겹을 맡는다 (나머지는 자산 URL 의 ?v= 와 진입점의 갱신 감지).
//
// ⚠️ CACHE_VERSION 과 아래 ?v= 는 scripts/bump-version.mjs 가 함께 올린다.
//    손으로 고치지 말 것 — 한 곳만 빠뜨려도 그 파일만 옛것이 나온다.

const CACHE_VERSION = 'dgf-v102';

const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './style.css?v=102',
  './admin.css?v=102',
  './script.js?v=102',
  './admin.js?v=102',
  './scripts/members-data.js?v=102',
  './scripts/hangul.js?v=102',
  './scripts/supabase-config.js?v=102',
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' 로 브라우저 HTTP 캐시를 건너뛴다.
      // 이게 없으면 설치 시점에 옛 파일을 그대로 다시 저장한다
      // (새 SW 인데 내용은 옛것인 최악의 상태).
      .then(cache => cache.addAll(
        PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' }))
      ).catch(err => console.log('[SW] 일부 precache 실패:', err)))
  );
  // 새 SW 가 즉시 활성화되어 구버전 캐시를 파기하도록 함
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_VERSION) {
            console.log('[SW] 구버전 캐시 강제 삭제:', k);
            return caches.delete(k);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// 앱 코드인가 (바뀌면 즉시 반영돼야 하는 것)
function isAppCode(url) {
  const p = url.pathname;
  return p.endsWith('/') || /\.(html|js|mjs|css|webmanifest|json)$/i.test(p);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 API 는 건드리지 않는다. 캐시되면 데이터가 안 바뀐다.
  if (url.host.includes('supabase.co') || url.host.includes('script.google.com')) return;
  if (url.origin !== self.location.origin) return;

  const save = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const clone = res.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
    }
    return res;
  };

  if (isAppCode(url)) {
    // 네트워크 우선. 끊겼을 때만 캐시로 버틴다.
    event.respondWith(
      fetch(req).then(save).catch(() =>
        caches.match(req).then(c => c || Promise.reject(new Error('오프라인'))))
    );
  } else {
    // 아이콘·이미지: 캐시 우선 (잘 안 바뀌고 용량이 크다)
    event.respondWith(caches.match(req).then(c => c || fetch(req).then(save)));
  }
});
