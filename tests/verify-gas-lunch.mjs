// GAS 김밥 읽기 검증 — X 를 신청으로 세지 않는가, 회차 목록을 같이 주는가.
//
// GAS 파일은 브라우저가 아니라 구글 서버에서 도는 코드라 여기서 실행할 수
// 없다. 다만 함수 대부분이 평범한 JS 라, 구글 전역만 가짜로 채워 주면
// 그대로 불러 볼 수 있다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';

const SRC = join(ROOT, 'scripts', 'gas', 'doGet.js');
const src = readFileSync(SRC, 'utf8');

const { ok, done } = makeReporter('GAS 김밥 읽기');

// 구글 전역 대역. 쓰는 것만 채운다.
const Utilities = {
  formatDate(d, tz, fmt) {
    const p = (n) => String(n).padStart(2, '0');
    const y = d.getUTCFullYear(), m = p(d.getUTCMonth() + 1), day = p(d.getUTCDate());
    return fmt === 'yyyy-MM-dd' ? `${y}-${m}-${day}` : `${m}/${day}`;
  },
};
const PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null }),
};
const stubs = { Utilities, PropertiesService, SpreadsheetApp: {}, LockService: {},
                ScriptApp: {}, UrlFetchApp: {}, ContentService: {}, Session: {} };

const sandbox = new Function(...Object.keys(stubs), `
  ${src}
  return { DG_isLunchApplied, DG_readLunchByDate, DG_TAB_LUNCH };
`)(...Object.values(stubs));

// --- 신청인가 아닌가 -------------------------------------------------------
const YES = ['O', 'o', 'ㅇ', '1', 'v', 'V', '✓', '신청', '2', 'O '];
const NO = ['', ' ', 'X', 'x', '×', '✕', '-', '－', '0', '취소', '없음', '안함', '.'];

const yesBad = YES.filter(v => !sandbox.DG_isLunchApplied(v));
const noBad = NO.filter(v => sandbox.DG_isLunchApplied(v));
ok('신청 표기는 신청으로 읽는다', yesBad.length === 0, yesBad.map(v => `‘${v}’`).join(', '));
ok('X · 빈칸 · 취소는 신청이 아니다', noBad.length === 0, noBad.map(v => `‘${v}’`).join(', '));

// --- 시트 한 장을 통째로 읽어 본다 -----------------------------------------
//
// 김밥 시트: 08/09 열에 한 명만 O, 나머지는 X 나 빈칸.
// 08/16 열은 아무도 신청하지 않았다 — 그래도 '읽은 회차' 로는 나와야 한다.
const VALUES = [
  ['DG-2026', '', '', ''],
  ['ID', '이름', '08/09', '08/16'],
  ['김철수1111', '김철수', 'O', ''],
  ['이영희2222', '이영희', 'X', ''],
  ['박민수3333', '박민수', 'x', ''],
  ['', '', 'O', 'O'],                 // ID 가 없는 줄은 무시
];
const fakeSS = {
  getSheetByName(name) {
    return name === sandbox.DG_TAB_LUNCH
      ? { getDataRange: () => ({ getValues: () => VALUES }) }
      : null;
  },
};

const got = sandbox.DG_readLunchByDate(fakeSS, 'Asia/Seoul');
const applied = Object.entries(got.byId)
  .filter(([, m]) => Object.keys(m).length)
  .map(([id]) => id);

ok('O 만 신청으로 센다', applied.length === 1 && applied[0] === '김철수1111',
   applied.join(', ') || '(없음)');
ok('X 를 적은 사람은 빈 값', Object.keys(got.byId['이영희2222'] || {}).length === 0,
   JSON.stringify(got.byId['이영희2222']));
ok('소문자 x 도 마찬가지', Object.keys(got.byId['박민수3333'] || {}).length === 0,
   JSON.stringify(got.byId['박민수3333']));

// 신청자가 없는 회차도 목록에는 있어야 한다 — 동기화가 그 회차를 비우는 근거다
ok('읽은 회차를 같이 돌려준다', Array.isArray(got.dates) && got.dates.length === 2,
   JSON.stringify(got.dates));
ok('신청자가 없는 회차도 목록에 든다', (got.dates || []).some(d => d.endsWith('-08-16')),
   JSON.stringify(got.dates));

// --- 응답에 실려 나가는가 ---------------------------------------------------
ok('doGet 응답에 lunchDates 를 싣는다', /lunchDates:\s*lunchInfo\.dates/.test(src));
ok('호출부가 새 모양(byId)을 쓴다', /var lunchByDate = lunchInfo\.byId;/.test(src));
// 번호를 콕 박아 두면 다음에 GAS 를 고칠 때마다 이 검사가 깨진다.
// 확인할 것은 '김밥 O/X 가 든 버전 이상인가' 와 '머리말과 상수가 같은가' 다.
const ver = Number(src.match(/var DG_VERSION = (\d+);/)?.[1]);
const headVer = Number(src.match(/전체 코드 \(v(\d+)\)/)?.[1]);
ok('v25 이상 (김밥 O/X 가 든 버전)', ver >= 25, `v${ver}`);
ok('머리말 버전과 DG_VERSION 이 같다', ver === headVer,
   `머리말 v${headVer} · DG_VERSION ${ver}`);

// 명단 차례를 시트와 맞추는 데 쓰는 값 (v26)
ok('인원에 sheetRow(시트 줄 번호)를 담는다', /obj\['sheetRow'\] = i;/.test(src));

done();
