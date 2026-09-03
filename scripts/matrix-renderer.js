import { getSessions, isClassSession } from './members-data.js?v=108';

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
    // 시트의 '-' 는 그 주에 수업이 없었다는 뜻이다. '돌봄' 같은 표기와 같이
    // 묶어 눈에 띄게 칠하면, 빠진 것처럼 읽혀 조장이 헛걸음한다.
    if (v === '-' || v === '−') return { label: '−', cls: 'none', title: '수업 없음' };
    return { label: v, cls: 'special', title: `시트 표기: ${v}` };
}

// 데이터 계층의 정규화와 같은 규칙. 회차 이름(시트)과 과제 이름(폼)이
// 서로 다르게 적히므로 양쪽을 같은 모양으로 만든 뒤에 견준다.
export function normalizeLectureKey(v) {
    const raw = String(v || '').replace(/\s/g, '');
    const m = raw.match(/^제?(\d+)강/);
    if (m) return m[1] + '강';
    if (/^자유교재/.test(raw)) return '자유교제';
    if (/^교재/.test(raw)) return '교제';
    return raw.toLowerCase();
}

// 회차를 컬럼으로 바꾼다. 두 키(date · name)를 같이 들고 다니는 게 핵심이다.
export function buildSessionColumns() {
    return getSessions()
        .map(s => ({
            date: s.date,                    // ← 출결·김밥을 찾을 키
            key: s.key,                      // ← 화면에 찍는 MM/DD
            name: s.name || '',              // ← 과제를 찾을 키
            isClass: isClassSession(s.name), // ← '자유교제' 같은 회차는 흐리게
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
export function renderTeamMatrixHTML(teamName, members, extras) {
    const cols = buildSessionColumns();
    const titleText = `👥 ${teamName} 전체 출석표 (${members.length}명 · ${cols.length}회차)`;

    const lunchMap = extras?.lunch || new Map();
    const hwMap = extras?.homework || new Map();

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
        return `<th class="${c.isClass ? '' : 'non-class'}${hideClass}">
            <span class="mx-session">${escapeHtml(c.name || '-')}</span>
            <span class="mx-date">${escapeHtml(c.key)}</span>
        </th>`;
    }).join('');

    const bodyRows = sorted.map(m => {
        const att = m.attendanceByDate || {};
        const present = cols.filter(c => String(att[c.date] || '').toUpperCase() === 'O').length;
        const myLunch = lunchMap.get(m._uuid) || null;
        const myHw = hwMap.get(m._uuid) || null;

        const cells = cols.map((c, i) => {
            const st = classifyStatus(att[c.date]);
            const lunch = !!(myLunch && myLunch.has(c.date));
            // 회차에 강의명이 없으면 과제를 붙일 근거가 없다. 순서로 짐작하지 않는다.
            const homework = !!(myHw && c.name && myHw.has(normalizeLectureKey(c.name)));

            const isReplaced = (st.label === 'X' || st.label.includes('대체')) && homework;
            if (isReplaced) {
                st.label = '과제';
                st.cls = 'makeup';
                st.title = '결석 — 과제·소감문으로 메움';
            }
            const hwIcon = homework ? (isReplaced ? '<span class="hw-badge">📝</span>' : '📝') : '';
            const badges = (lunch ? '🍙' : '') + hwIcon;
            const tip = [m.name, c.key, c.name, st.title,
                         lunch ? '🍙 김밥 신청' : '', homework ? '📝 과제+소감문 제출' : '']
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

    const foldBtnHtml = foldedCount > 0
        ? `<button type="button" class="matrix-fold-btn" onclick="document.querySelector('.matrix-table').classList.toggle('folded'); this.textContent = this.textContent.includes('전체') ? '최근 10회차 보기' : '전체보기'">전체보기</button>`
        : '';

    const tableHTML = `
        <table class="matrix-table folded">
            <thead><tr><th class="mx-name-cell mx-corner">조원</th>${headRow}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;

    return { titleText, tableHTML, foldBtnHtml };
}
