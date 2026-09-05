// 조 전체 출석표(매트릭스) — 조회 화면과 관리자 화면이 함께 쓴다.
//
// ⚠️ **칸 값을 어디서 읽는지가 이 파일의 전부다.** 기본값은 `m.attendanceByDate` 인데
// 그 객체를 전 회차로 채우는 것은 `refreshAttendance()`(GAS 왕복) 뿐이고,
// **관리자 화면은 그것을 부르지 않는다.** 새 화면에서 쓸 때는 `getStatus` 를 넘길 것.
// 안 넘기면 값이 한 열만 차는데 오류가 안 나고, localStorage 캐시 때문에 개발 중엔
// 되는 것처럼 보인다 — 확인은 시크릿 창에서. (자세히는 docs/HANDOVER.md)
//
// 노란 '과제' 칸은 두 갈래로 들어온다 — 시트가 적어 준 '과제' 와, 앱이 X + 과제제출을
// 보고 스스로 칠하는 것. 둘 다 makeup 이라 모양이 같다. 뜻과 셈법은 docs/RULES.md.

import { getSessions, getToday, homeworkKindLabel, isClassSession, isMakeup, isPresent, normalizeLecture } from './members-data.js?v=118';

export function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export const escapeAttr = escapeHtml;

// 시트 값을 표시용으로 나눈다. O·X 말고도 사람이 적은 표기가 들어온다.
export function classifyStatus(raw) {
    const v = String(raw || '').trim();
    if (v === '') return { label: '·', cls: 'empty', title: '기록 없음' };
    const up = v.toUpperCase();
    if (up === 'O') return { label: 'O', cls: 'present', title: '출석' };
    if (up === 'X') return { label: 'X', cls: 'absent', title: '결석' };
    // 시트가 '과제' 로 바꿔 둔 칸. 앱이 X + 과제제출을 보고 스스로 칠하는
    // 칸(아래 isReplaced)과 **같은 모양**이어야 한다 — 뜻이 같기 때문이다.
    // 여기가 아래(special)로 새면 파란 칸이 되어 두 모양이 갈린다.
    if (isMakeup(v)) return { label: '과제', cls: 'makeup', title: '과제·소감문으로 인정 (시트 표기)' };
    // 시트의 '-' 는 그 주에 수업이 없었다는 뜻이다. '돌봄' 같은 표기와 같이
    // 묶어 눈에 띄게 칠하면, 빠진 것처럼 읽혀 조장이 헛걸음한다.
    if (v === '-' || v === '−') return { label: '−', cls: 'none', title: '수업 없음' };
    return { label: v, cls: 'special', title: `시트 표기: ${v}` };
}

// 회차를 컬럼으로 바꾼다. 두 키(date · name)를 같이 들고 다니는 게 핵심이다.
export function buildSessionColumns() {
    const today = getToday();
    // 지난 회차 + **다가오는 회차 하나**. 다음 주에 무엇을 하는지 보여야 준비가 된다.
    return getSessions({ throughNext: true })
        .map(s => ({
            date: s.date,                    // ← 출결·김밥을 찾을 키
            key: s.key,                      // ← 화면에 찍는 MM/DD
            name: s.name || '',              // ← 과제를 찾을 키
            isClass: isClassSession(s.name), // ← '자유교제' 같은 회차는 흐리게
            isUpcoming: s.date > today,      // ← 아직 안 온 주
        }))
        .filter(c => c.date);
}

const rolePriority = {
    "관리자": 1,
    "조장": 2,
    "서브튜터": 3,
    "조원": 4,
    "": 4
};

// extras 는 getTeamExtras() 결과. 없으면 뱃지 없이 그대로 그린다
// (모달을 여는 순간 표는 뜨고, 김밥·과제는 도착하는 대로 다시 그린다).
/**
 * 조 전체 출석표 HTML.
 *
 * ⚠️ 칸 값을 어디서 읽는지가 이 함수의 함정이다. 기본값은 `m.attendanceByDate`
 * 인데, **그 객체를 전 회차로 채우는 것은 `refreshAttendance()`(GAS 왕복) 뿐이다.**
 * 조회 화면(조장)은 조원 명단을 열 때 그것을 부르지만 **관리자 화면은 안 부른다** —
 * 거기서는 `loadAttendanceForSession()` 이 넣은 **한 회차**만 들어 있다.
 *
 * 그래서 관리자처럼 다른 곳에서 쓸 때는 `getStatus` 를 반드시 넘긴다.
 * 안 넘기면 나머지 열이 전부 `·`(기록 없음)로 나오는데 **오류가 안 나서 조용히
 * 틀린다.** 게다가 같은 브라우저로 조장 화면을 먼저 열었으면 localStorage 캐시
 * 덕에 맞아 보이므로, 확인은 반드시 **시크릿 창**에서 할 것.
 *
 * @param {object} [opts]
 * @param {(member, date) => string} [opts.getStatus] 칸 값을 읽는 함수
 */
export function renderTeamMatrixHTML(teamName, members, extras, opts = {}) {
    const getStatus = opts.getStatus
        || ((m, date) => (m.attendanceByDate || {})[date]);
    const cols = buildSessionColumns();
    const titleText = `👥 ${teamName} 전체 출석표 (${members.length}명 · ${cols.length}회차)`;

    const lunchMap = extras?.lunch || new Map();
    const hwMap = extras?.homework || new Map();          // 인정 대상 (과제+소감문)
    const hwKindMap = extras?.homeworkKinds || new Map();  // 실제로 낸 종류 그대로

    const sorted = [...members].sort((a, b) => {
        const pa = rolePriority[a.role] || 4;
        const pb = rolePriority[b.role] || 4;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name, 'ko');
    });

    const MAX_OPEN = 10;
    const foldedCount = Math.max(0, cols.length - MAX_OPEN);

    const headRow = cols.map((c, i) => {
        const hideClass = i < foldedCount ? ' old-col' : '';
        const cls = [c.isClass ? '' : 'non-class', c.isUpcoming ? 'upcoming' : '', hideClass.trim()]
            .filter(Boolean).join(' ');
        return `<th class="${cls}">
            <span class="mx-session">${escapeHtml(c.name || '-')}</span>
            <span class="mx-date">${escapeHtml(c.key)}</span>
            ${c.isUpcoming ? '<span class="mx-soon">예정</span>' : ''}
        </th>`;
    }).join('');

    const bodyRows = sorted.map(m => {
        const present = cols.filter(c => isPresent(getStatus(m, c.date))).length;
        const myLunch = lunchMap.get(m._uuid) || null;
        const myHw = hwMap.get(m._uuid) || null;
        const myHwKinds = hwKindMap.get(m._uuid) || null;

        const cells = cols.map((c, i) => {
            const st = classifyStatus(getStatus(m, c.date));
            const lunch = !!(myLunch && myLunch.has(c.date));
            // 회차에 강의명이 없으면 과제를 붙일 근거가 없다. 순서로 짐작하지 않는다.
            const lecKey = c.name ? normalizeLecture(c.name) : '';
            // homework = **인정 대상**. 종류가 '과제+소감문' 인 것만이다.
            const homework = !!(myHw && lecKey && myHw.has(lecKey));
            // '과제+소감문' 이 아닌 제출 (예습과제 등).
            const partKinds = (!homework && lecKey && myHwKinds?.get(lecKey)) || [];

            // 시트가 이미 '과제' 로 바꿔 둔 칸은 classifyStatus 가 makeup 으로
            // 돌려준다 — 다시 칠할 것이 없다.
            const fromSheet = st.cls === 'makeup';

            // 시트가 아직 못 잡은 칸: 결석인데 과제+소감문 기록이 있다.
            // (아이디가 안 맞았거나 '전체 결석 일괄 동기화' 를 아직 안 돌렸다.)
            const isReplaced = !c.isUpcoming && st.cls === 'absent' && homework;
            if (isReplaced) {
                st.label = '과제';
                st.cls = 'makeup';
                st.title = '결석 — 과제·소감문으로 메움';
            }

            // 두 갈래를 한 모양으로 본다. 뜻이 같으므로 뱃지도 같아야 한다.
            const makeupCell = fromSheet || isReplaced;

            // 아직 안 온 주. '·(기록 없음)' 으로 두면 전원이 빠진 것처럼 읽힌다.
            // 뱃지는 남긴다 — 김밥 신청과 과제 제출은 미리 받는다.
            if (c.isUpcoming) {
                st.label = '·';
                st.cls = 'upcoming';
                st.title = '아직 안 온 회차';
            }

            // ⚠️ **소감문은 결석을 메우는 것**이다 (공지 규칙 5). 나온 주에는
            // 요구할 것이 아니므로, '종류가 모자라다' 고 흐리게 그리는 것은
            // **결석한 칸에만** 뜻이 있다. 출석한 주의 예습과제는 다 한 것이다.
            const lacking = !c.isUpcoming && st.cls === 'absent' && partKinds.length > 0;
            const hwIcon = homework ? (makeupCell ? '<span class="hw-badge">📝</span>' : '📝')
                         : lacking ? '<span class="hw-partial">📝</span>'
                         : partKinds.length ? '📝' : '';
            const badges = (lunch ? '🍙' : '') + hwIcon;
            const tip = [m.name, c.key, c.name, st.title,
                         lunch ? '🍙 김밥 신청' : '',
                         homework ? '📝 과제+소감문 제출'
                         : lacking ? `📝 ${homeworkKindLabel(partKinds)} 제출 (결석을 메우려면 과제+소감문)`
                         : partKinds.length ? `📝 ${homeworkKindLabel(partKinds)} 제출` : '']
                        .filter(Boolean).join(' · ');

            const hideClass = i < foldedCount ? ' old-col' : '';
            return `<td class="mx-cell ${st.cls}${c.isClass ? '' : ' non-class'}${hideClass}" title="${escapeAttr(tip)}">
                        <span class="mx-status">${escapeHtml(st.label)}</span>
                        ${badges ? `<span class="mx-badges">${badges}</span>` : ''}
                    </td>`;
        }).join('');

        return `
            <tr>
                <th class="mx-name-cell" scope="row">
                    <span class="mx-name">${escapeHtml(m.name)}</span>
                    <span class="mx-role">${escapeHtml(m.role || '조원')} · 출석 ${present}</span>
                </th>
                ${cells}
            </tr>
        `;
    }).join('');

    // 인라인 onclick 대신 표식만 남긴다. 전역 querySelector 로 표를 찾으면
    // 표가 둘이 되는 순간 엉뚱한 것을 접는다 — 누르는 쪽에서 제 표를 찾게 한다.
    const foldBtnHtml = foldedCount > 0
        ? `<button type="button" class="matrix-fold-btn" data-matrix-fold
                   aria-expanded="false">전체 ${cols.length}회차 보기</button>`
        : '';

    const tableHTML = `
        <table class="matrix-table folded">
            <thead><tr><th class="mx-name-cell mx-corner">조원</th>${headRow}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;

    return { titleText, tableHTML, foldBtnHtml };
}
