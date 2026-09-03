// 동기화가 남기는 기록 — 공개 로그에 실명이 새지 않는가, 안 맞는 아이디를
// 손볼 곳별로 나누는가.
//
// ⚠️ 이 저장소는 public 이다. Actions 로그도 누구나 읽는다. 파일에 실명을
// 안 넣는 것과 같은 이유로 로그에도 안 넣는다 — 그런데 로그는 눈에 잘 안 띈다.

import { makeReporter } from './lib/harness.mjs?v=108';

const { ok, done } = makeReporter('동기화 기록');

// PUBLIC_LOG 는 모듈을 읽는 순간 정해진다. 두 경우를 다 보려면 각각 읽어야 한다.
async function load(inActions) {
  if (inActions) process.env.GITHUB_ACTIONS = 'true';
  else delete process.env.GITHUB_ACTIONS;
  // ?v= 로 모듈 캐시를 피한다 (같은 경로는 한 번만 읽힌다)
  return import(`../scripts/sync-report.mjs?actions=${inActions}`);
}

const NAMES = ['김조원1111', '박신입2222'];

// --- 공개 로그 --------------------------------------------------------------
const pub = await load(true);
const masked = pub.peopleList(NAMES);
ok('Actions 안에서는 이름을 안 적는다',
   !masked.includes('김조원') && !masked.includes('1111'), masked);
ok('대신 어디서 보는지 알려준다', /로컬에서 돌리면/.test(masked), masked);
ok('건수는 부르는 쪽이 적는다 (여기서는 이름만 가린다)',
   !/2명/.test(masked), masked);
ok('빈 목록이면 아무 말도 안 한다', pub.peopleList([]) === '', `'${pub.peopleList([])}'`);

// --- 손으로 돌릴 때 ---------------------------------------------------------
const local = await load(false);
ok('로컬에서는 그대로 보여준다 — 고치려면 누구인지 알아야 한다',
   local.peopleList(NAMES) === '김조원1111, 박신입2222', local.peopleList(NAMES));

// --- 안 맞는 아이디 갈래 ----------------------------------------------------
//
// 35명을 한 줄에 늘어놓으면 셋이 섞여 있어 무엇부터 볼지 알 수 없다.
// 고치는 자리가 갈래마다 다르다 — 폼 응답 · 오타 · 명단.
const ROSTER = [
  { name: '조혜진', phone: '5698', team: 'YF1' },
  { name: '김도현', phone: '5326', team: 'YM1' },
  { name: '이영희', phone: '3333', team: 'C1' },
];
const groups = Object.fromEntries(local.classifyUnknownIds([
  '김도현9999',            // 이름은 맞는데 번호가 다르다
  '조헤진5698',            // 뒤 4자리는 맞고 이름이 한 글자 다르다
  '한번도없던사람7777',      // 둘 다 안 맞는다
  '차병옥DGV1일요일오전나눔', // 아이디 꼴이 아니다
], ROSTER));

ok('이름이 있으면 번호 문제로 본다', groups['번호가 다름'].length === 1 &&
   /김도현9999/.test(groups['번호가 다름'][0]), groups['번호가 다름'].join(' / '));
ok('명단의 번호를 같이 알려준다', /5326/.test(groups['번호가 다름'][0]),
   groups['번호가 다름'][0]);
ok('번호가 맞고 이름이 한 글자 다르면 오타로 본다',
   groups['이름 한 글자 차이'].length === 1 && /조헤진5698/.test(groups['이름 한 글자 차이'][0]),
   groups['이름 한 글자 차이'].join(' / '));
ok('명단의 이름을 같이 알려준다', /조혜진/.test(groups['이름 한 글자 차이'][0]),
   groups['이름 한 글자 차이'][0]);
ok('둘 다 안 맞으면 명단 문제로 본다', groups['명단에 없음'].length === 2,
   groups['명단에 없음'].join(' / '));
ok('아이디 꼴이 아닌 것도 버리지 않고 남긴다',
   groups['명단에 없음'].some(x => /차병옥/.test(x)), groups['명단에 없음'].join(' / '));

// 갈래를 나눠도 사람이 사라지면 안 된다 — 넷을 넣었으면 넷이 나와야 한다
const total = Object.values(groups).reduce((n, v) => n + v.length, 0);
ok('넣은 만큼 그대로 나온다 (갈래에서 새지 않는다)', total === 4, `${total}명`);

// --- 아이디 정규화은 GAS 와 같은 규칙 ---------------------------------------
ok('전각 숫자를 반각으로', local.normId('김도현５３２６') === '김도현5326',
   local.normId('김도현５３２６'));
ok('기호·공백은 지운다', local.normId('김도현 (5326)') === '김도현5326',
   local.normId('김도현 (5326)'));
ok('전각으로 낸 사람도 명단과 짝이 맞는다',
   local.normId('김도현５３２６') === local.normId('김도현5326'));

done();
