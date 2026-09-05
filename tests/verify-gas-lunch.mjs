// GAS 읽기 검증 — 김밥 O/X, 회차 목록, 그리고 아이디 정규화.
//
// GAS 파일은 브라우저가 아니라 구글 서버에서 도는 코드라 여기서 실행할 수
// 없다. 다만 함수 대부분이 평범한 JS 라, 구글 전역만 가짜로 채워 주면
// 그대로 불러 볼 수 있다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';

const SRC = join(ROOT, 'scripts', 'gas', 'doGet.js');
const src = readFileSync(SRC, 'utf8');

const { ok, done } = makeReporter('GAS 읽기');

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
// 시트 대역. '과제 아이디 점검' 은 시트를 읽고 시트에 쓰므로 여기까지 필요하다.
const SHEETS = {};
function fakeSheet(name, values) {
  const written = [];
  return {
    name,
    values,
    written,
    getDataRange: () => ({ getValues: () => values }),
    clear() { written.length = 0; },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { v.forEach((row, i) => { written[r - 1 + i] = row; }); return this; },
        setFontWeight() { return this; },
      };
    },
    setFrozenRows() {},
    autoResizeColumns() {},
  };
}
const SpreadsheetAppStub = {
  openById: () => ({
    getSheetByName: (n) => SHEETS[n] || null,
    insertSheet: (n) => (SHEETS[n] = fakeSheet(n, [])),
  }),
  // 메뉴가 아니라 편집기에서 돌리면 UI 가 없다 — 그 길도 지나가 본다
  getUi: () => { throw new Error('no ui'); },
};
const Logger = { log: () => {} };

const stubs = { Utilities, PropertiesService, SpreadsheetApp: SpreadsheetAppStub,
                LockService: {}, ScriptApp: {}, UrlFetchApp: {}, ContentService: {},
                Session: { getScriptTimeZone: () => 'Asia/Seoul' }, Logger };

const sandbox = new Function(...Object.keys(stubs), `
  ${src}
  return { DG_isLunchApplied, DG_readLunchByDate, DG_normalizeId_, DG_TAB_LUNCH,
           DG_checkHomeworkIds, DG_TAB_ROSTER, DG_TAB_HOMEWORK };
`)(...Object.values(stubs));

// --- 신청인가 아닌가 -------------------------------------------------------
const YES = ['O', 'o', 'ㅇ', '1', 'v', 'V', '✓', '신청', '2', 'O '];
const NO = ['', ' ', 'X', 'x', '×', '✕', '-', '－', '0', '취소', '없음', '안함', '.'];

const yesBad = YES.filter(v => !sandbox.DG_isLunchApplied(v));
const noBad = NO.filter(v => sandbox.DG_isLunchApplied(v));
ok('신청 표기는 신청으로 읽는다', yesBad.length === 0, yesBad.map(v => `‘${v}’`).join(', '));
ok('X · 빈칸 · 취소는 신청이 아니다', noBad.length === 0, noBad.map(v => `‘${v}’`).join(', '));

// --- 아이디 정규화 ---------------------------------------------------------
//
// 아이디는 '이름+전화뒷4' 를 기대하는데 손입력과 폼 응답이 섞여 들어온다.
// 기호만 지우면 전각 숫자는 통째로 사라져 이름만 남고, 명단과 짝이 안 맞아
// 그 사람의 과제가 조용히 버려진다.
const norm = sandbox.DG_normalizeId_;
const 같은사람 = ['김도현5326', '김도현 5326', '김도현-5326', '김도현(5326)',
                  '김도현５３２６', ' 김도현 5326 ', '김도현_5326'];
const 결과 = 같은사람.map(norm);
ok('제각각 적어도 한 아이디로 모인다', 결과.every(v => v === '김도현5326'),
   결과.map((v, i) => `${같은사람[i]} → ${v}`).join(' | '));
ok('전각 숫자가 지워지지 않고 반각이 된다', norm('김도현５３２６') === '김도현5326',
   norm('김도현５３２６'));
ok('전각 영문도 반각으로', norm('ＡＢ12') === 'AB12', norm('ＡＢ12'));
ok('빈 값은 빈 값', norm(null) === '' && norm('') === '' && norm('   ') === '');
ok('다른 사람은 그대로 다르다', norm('김도현5326') !== norm('김도연5326'),
   `${norm('김도현5326')} vs ${norm('김도연5326')}`);

// 동기화 쪽도 같은 규칙을 써야 짝이 맞는다 (한쪽만 다듬으면 더 어긋난다).
// 규칙은 scripts/sync-report.mjs 한 곳에만 있고, 동기화는 그것을 가져다 쓴다.
const reportSrc = readFileSync(join(ROOT, 'scripts', 'sync-report.mjs'), 'utf8');
const syncSrc = readFileSync(join(ROOT, 'scripts', 'sync-sheet-to-db.mjs'), 'utf8');
ok('동기화 쪽에도 같은 규칙이 있다',
   /Ａ-Ｚａ-ｚ０-９/.test(reportSrc) && /normalize\('NFC'\)/.test(reportSrc));
ok('규칙을 두 번 적어 두지 않는다', !/Ａ-Ｚａ-ｚ０-９/.test(syncSrc)
   && /from '\.\/sync-report\.mjs'/.test(syncSrc));
ok('아이디를 맞추는 자리에서 그 규칙을 쓴다',
   (syncSrc.match(/uuidById\.get\(normId\(/g) || []).length >= 2,
   `${(syncSrc.match(/uuidById\.get\(normId\(/g) || []).length}곳`);

// GAS 안에서도 아이디를 만드는 자리마다 이 함수를 쓴다 — 한 곳만 빼먹으면
// 그 탭만 조용히 어긋난다.
ok('GAS 안 모든 아이디 자리가 이 함수를 쓴다',
   (src.match(/DG_normalizeId_\(/g) || []).length >= 8
   && (src.match(/\[\^a-zA-Z0-9가-힣\]/g) || []).length === 1,
   `호출 ${(src.match(/DG_normalizeId_\(/g) || []).length}곳 · 남은 인라인 ${(src.match(/\[\^a-zA-Z0-9가-힣\]/g) || []).length}`);

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

// --- 결과 카드의 김밥도 같은 규칙인가 (v30) ---------------------------------
//
// v25 는 DG_readLunchByDate(회차별)만 고쳤다. doGet 안의 kimbapMap 은 아직
// '값이 있기만 하면 O' 였다 — 결과 카드 한 줄, 조 요약의 🍙 N, 조원 명단의 🍙 가
// 그 값을 쓴다. 안 한다고 X 를 적은 사람이 대상자로 세어져 김밥을 더 시킨다.
ok('결과 카드의 김밥도 DG_isLunchApplied 를 쓴다',
   /kimbapMap\[kbId\] = DG_isLunchApplied\(/.test(src));
ok("옛 '값이 있기만 하면 O' 가 남아 있지 않다",
   !/kimbapMap\[kbId\] = String\([^)]*\)\.trim\(\) !== ''/.test(src));

// --- 응답에 실려 나가는가 ---------------------------------------------------
ok('doGet 응답에 lunchDates 를 싣는다', /lunchDates:\s*lunchInfo\.dates/.test(src));
ok('호출부가 새 모양(byId)을 쓴다', /var lunchByDate = lunchInfo\.byId;/.test(src));
// 번호를 콕 박아 두면 다음에 GAS 를 고칠 때마다 이 검사가 깨진다.
// 확인할 것은 '김밥 O/X 가 든 버전 이상인가' 와 '머리말과 상수가 같은가' 다.
const ver = Number(src.match(/var DG_VERSION = (\d+);/)?.[1]);
const headVer = Number(src.match(/전체 코드 \(v(\d+)\)/)?.[1]);
ok('v30 이상 (결과 카드의 김밥까지 X 를 거르는 버전)', ver >= 30, `v${ver}`);
ok('머리말 버전과 DG_VERSION 이 같다', ver === headVer,
   `머리말 v${headVer} · DG_VERSION ${ver}`);

// 명단 차례를 시트와 맞추는 데 쓰는 값 (v26)
ok('인원에 sheetRow(시트 줄 번호)를 담는다', /obj\['sheetRow'\] = i;/.test(src));

// --- 과제 아이디 점검 (v29) --------------------------------------------------
//
// 아이디가 안 맞으면 그 사람의 과제가 조용히 버려진다. 공개 저장소의 Actions
// 로그에는 이름을 적을 수 없으니, 이름을 봐도 되는 자리(시트)에 적는다.
SHEETS[sandbox.DG_TAB_ROSTER] = fakeSheet(sandbox.DG_TAB_ROSTER, [
  ['DG-2026', '', '', ''],
  ['id', '이름', '조', '09/06'],
  ['조혜진5698', '조혜진', 'YF1', 'O'],
  ['김도현5326', '김도현', 'YM1', 'O'],
  ['이영희3333', '이영희', 'C1', ''],
]);
SHEETS[sandbox.DG_TAB_HOMEWORK] = fakeSheet(sandbox.DG_TAB_HOMEWORK, [
  ['타임스탬프', '아이디', '연락처', '몇 강인가요?', '어떤 과제인가요?'],
  ['2026. 8. 20. 오후 3:04:00', '김도현5326', '', '18강', '독후감'],   // 맞음
  ['2026. 8. 20. 오후 3:05:00', '김도현５３２６', '', '17강', '독후감'], // 전각도 맞음
  ['2026. 8. 20. 오후 3:06:00', '김도현9999', '', '16강', '독후감'],   // 번호가 다름
  ['2026. 8. 20. 오후 3:07:00', '조헤진5698', '', '15강', '독후감'],   // 이름 오타
  ['2026. 8. 20. 오후 3:08:00', '없는사람7777', '', '14강', '독후감'], // 명단에 없음
  ['2026. 8. 20. 오후 3:09:00', '차병옥DG일요일', '', '13강', '독후감'], // 아이디 꼴이 아님
  ['', '', '', '', ''],                                                // 빈 줄은 건너뛴다
]);

sandbox.DG_checkHomeworkIds();

const report = SHEETS['과제ID점검'];
ok('점검 결과를 시트에 적는다', !!report && report.written.length > 0,
   report ? `${report.written.length}줄` : '(탭이 안 생김)');

const head = String(report.written[0][0]);
ok('맞은 건수와 안 맞은 건수를 함께 적는다', /맞은 제출 2건/.test(head) && /안 맞은 제출 4건/.test(head),
   head);
ok('전각으로 낸 것도 맞은 것으로 센다 (v28 규칙)', /맞은 제출 2건/.test(head), head);

const body = report.written.slice(5).filter(r => r && r[2]);
const rowOf = (id) => body.find(r => String(r[2]).indexOf(id) !== -1) || [];

ok('이름이 명단에 있으면 번호 문제로 본다', rowOf('김도현9999')[0] === '번호가 다름',
   rowOf('김도현9999').join(' | '));
ok('명단의 번호를 후보로 알려준다', /5326/.test(String(rowOf('김도현9999')[3])),
   String(rowOf('김도현9999')[3]));
ok('번호가 맞고 이름이 한 글자 다르면 오타로 본다',
   rowOf('조헤진5698')[0] === '이름 한 글자 차이', rowOf('조헤진5698').join(' | '));
ok('명단의 이름을 후보로 알려준다', /조혜진5698/.test(String(rowOf('조헤진5698')[3])),
   String(rowOf('조헤진5698')[3]));
ok('둘 다 안 맞으면 명단 문제로 본다', rowOf('없는사람7777')[0] === '명단에 없음',
   rowOf('없는사람7777').join(' | '));
ok('아이디 꼴이 아닌 것도 버리지 않는다', rowOf('차병옥')[0] === '명단에 없음',
   rowOf('차병옥').join(' | '));
ok('꼴이 왜 아닌지 알려준다', /이름\+전화 뒷 4자리/.test(String(rowOf('차병옥')[3])),
   String(rowOf('차병옥')[3]));

// 줄 번호가 없으면 고치러 갈 수가 없다 (헤더 1행 + 데이터 4번째 = 4줄)
ok('시트 몇 줄인지 적는다 — 고치러 가야 한다', rowOf('김도현9999')[1] === 4,
   `${rowOf('김도현9999')[1]}줄`);
ok('몇 강인지도 같이 적는다', rowOf('김도현9999')[4] === '16강', rowOf('김도현9999')[4]);

// 갈래가 섞여 있으면 무엇부터 볼지 알 수 없다
const kinds = body.map(r => r[0]);
ok('갈래로 묶어서 보여준다',
   kinds.join(',') === '번호가 다름,이름 한 글자 차이,명단에 없음,명단에 없음',
   kinds.join(' → '));

// 지난 결과가 남으면 이미 고친 건까지 다시 고치려 든다
const beforeLen = report.written.length;
sandbox.DG_checkHomeworkIds();
ok('다시 돌리면 지난 결과를 지우고 쓴다',
   SHEETS['과제ID점검'].written.length === beforeLen,
   `${beforeLen} → ${SHEETS['과제ID점검'].written.length}줄`);

// 메뉴에 없으면 아무도 못 쓴다
ok('메뉴에서 부를 수 있다', /addItem\('과제 아이디 점검', 'DG_checkHomeworkIds'\)/.test(src));

done();
