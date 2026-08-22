// 동기화가 남기는 '기록' 을 만드는 곳 — 아이디 정규화와 로그 문구.
//
// 동기화 스크립트에서 떼어 둔 이유는 하나다: 여기 규칙이 틀리면 사람의 과제가
// 조용히 사라지거나, 실명이 공개 로그에 남는다. 둘 다 오류가 안 나서 안 보인다.
// 떼어 두면 검증이 이 규칙만 따로 확인할 수 있다.

/**
 * 아이디를 한 규칙으로 다듬는다 (GAS 의 DG_normalizeId_ 와 같은 규칙).
 *
 * 아이디는 '이름+전화뒷4' 인데 손입력과 폼 응답이 섞여 들어온다.
 *   '김도현 5326' · '김도현-5326' · '김도현(5326)' · '김도현５３２６'
 * 기호만 지우면 전각 숫자는 통째로 사라져 이름만 남고, 명단과 짝이 안 맞아
 * 그 사람의 과제·출석이 조용히 버려진다.
 *
 * **만드는 쪽과 맞추는 쪽 모두** 같은 규칙을 써야 한다. 한쪽만 다듬으면
 * 오히려 더 어긋난다. GAS 를 아직 새 버전으로 안 올렸어도 여기서 한 번 더
 * 다듬으므로 짝은 맞는다.
 */
export const normId = (v) => String(v == null ? '' : v)
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .normalize('NFC')
  .replace(/[^a-zA-Z0-9가-힣]/g, '');

/**
 * 로그에 사람 이름·전화를 적어도 되는가.
 *
 * ⚠️ 이 저장소는 public 이다. **Actions 로그도 누구나 읽는다.**
 * '⚠️ 명단에 없어 무시 35명: 이섬견0691, …' 처럼 찍으면 실명과 전화 뒷자리가
 * 그대로 공개된다. 파일에 안 넣는 것과 같은 이유로 로그에도 안 넣는다.
 *
 * 손으로 돌릴 때(로컬)는 그대로 보여준다 — 고치려면 누구인지 알아야 하고,
 * 그 화면은 돌린 사람만 본다.
 */
export const PUBLIC_LOG = !!process.env.GITHUB_ACTIONS;

/**
 * 공개 로그에서는 사람 목록을 건수로만 적는다.
 *
 * 이름을 지우고 건수만 남기면 무엇을 고쳐야 할지 모르게 되므로, 어디서
 * 봐야 하는지를 대신 적어 준다.
 */
export function peopleList(items, hint = '') {
  if (!items.length) return '';
  if (!PUBLIC_LOG) return items.join(', ');
  return `(이름은 로그에 남기지 않습니다 — 로컬에서 돌리면 보입니다${hint ? '. ' + hint : ''})`;
}

/**
 * 명단에 없는 아이디를 손볼 곳별로 나눈다.
 *
 * 35명을 한 줄에 늘어놓으면 셋 다 섞여 있어 무엇부터 봐야 할지 알 수 없다.
 * 고치는 자리가 갈래마다 다르다.
 *
 *   번호가 다름      이름은 명단에 있는데 뒤 4자리가 다르다 → 폼 응답을 고친다
 *   이름 한 글자 차이 뒤 4자리는 맞는다 ('조헤진' vs '조혜진') → 오타다
 *   명단에 없음      둘 다 안 맞는다 → 다른 기수이거나 아직 명단에 안 올랐다
 */
export function classifyUnknownIds(uniq, roster) {
  const byName = new Map();
  const byPhone = new Map();
  for (const m of roster) {
    const name = normId(m.name);
    const phone = String(m.phone || '');
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(m);
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(m);
  }

  // 한 글자만 다른가 (바뀜·빠짐·더해짐 한 번까지)
  const oneApart = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  };

  const out = { '번호가 다름': [], '이름 한 글자 차이': [], '명단에 없음': [] };
  for (const raw of uniq) {
    const id = normId(raw);
    const m = id.match(/^(.*?)(\d{4})$/);
    const name = m ? m[1] : id;
    const phone = m ? m[2] : '';

    const sameName = byName.get(name) || [];
    if (m && sameName.length) {
      out['번호가 다름'].push(`${raw} → 명단 ${sameName.map(x => x.phone).join('/')}`);
      continue;
    }
    const samePhone = (byPhone.get(phone) || []).filter(x => oneApart(normId(x.name), name));
    if (m && samePhone.length) {
      out['이름 한 글자 차이'].push(`${raw} → 명단 ${samePhone.map(x => x.name).join('/')}`);
      continue;
    }
    out['명단에 없음'].push(raw);
  }
  return Object.entries(out);
}
