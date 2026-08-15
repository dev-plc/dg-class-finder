// 1. 데이터 계층
//
// 화면은 아래 함수들만 쓴다. 어디서 데이터가 오는지(Supabase·시트)는 알지 못한다.
import {
    ensureLoaded,
    findMember,
    getTeamMembers,
    getLocationImage,
    getTeamLink,
    getSessions,
    getMyAttendance,
    getMyHomework,
    getSession,
    setSession,
    getTeamExtras,
    isClassSession,
    refreshAttendance,
    saveAttendance,
    subscribe,
} from './scripts/members-data.js?v=71';

// 1-1. 내 정보 기억
//
// 매번 이름·번호를 다시 치는 게 번거롭다. 마지막 조회를 기억해 채워 둔다.
//
// 저장은 이 브라우저 안(localStorage)에만 한다. DB 에 두면 누가 언제 누구를
// 조회했는지가 서버에 남는데, 편의 하나 때문에 그런 기록을 만들 이유가 없다.
// 공용 기기를 생각해 90일이 지나면 스스로 지운다.
const LAST_SEARCH_KEY = 'dg_last_search_v1';
const LAST_SEARCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function saveLastSearch(name, phone) {
    try {
        localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({ name, phone, ts: Date.now() }));
    } catch { /* 무시 */ }
}

function loadLastSearch() {
    try {
        const raw = localStorage.getItem(LAST_SEARCH_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj?.name || !obj?.phone) return null;
        if (obj.ts && Date.now() - obj.ts > LAST_SEARCH_MAX_AGE_MS) {
            localStorage.removeItem(LAST_SEARCH_KEY);
            return null;
        }
        return obj;
    } catch { return null; }
}

function clearLastSearch() {
    try { localStorage.removeItem(LAST_SEARCH_KEY); } catch { /* 무시 */ }
}

// 기억한 값이 있으면 채우고 '다른 사람으로 조회' 버튼을 보인다.
function applyLastSearch() {
    const last = loadLastSearch();
    if (!last) return;
    if (elements.nameInput) elements.nameInput.value = last.name;
    if (elements.phoneInput) elements.phoneInput.value = last.phone;
    if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
}

// 2. DOM 요소 선택
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
    searchBtnText: document.querySelector('#searchBtn .btn-text'),
    resultContainer: document.getElementById('resultContainer'),
    errorMessage: document.getElementById('errorMessage'),
    errorText: document.getElementById('errorText'),
    closeBtn: document.getElementById('closeBtn'),
    resultName: document.getElementById('resultName'),
    resultTeam: document.getElementById('resultTeam'),
    resultLocation: document.getElementById('resultLocation'),
    resultLunch: document.getElementById('resultLunch'),
    mapContainer: document.getElementById('mapContainer'),
    mapImage: document.getElementById('mapImage'),
    themeToggle: document.getElementById('themeToggle'),
    adminBtn: document.getElementById('adminBtn'),
    adminModal: document.getElementById('adminLoginModal'),
    adminClose: document.getElementById('adminLoginClose'),
    adminForm: document.getElementById('adminLoginForm'),
    clearRememberedBtn: document.getElementById('clearRememberedBtn')
};

// 3. 데이터 로드
//
// 캐시가 있으면 즉시 버튼을 열고 뒤에서 갱신한다.
// 처음 들어온 사람만 받아올 때까지 기다린다.
async function loadData() {
    try {
        elements.searchBtn.disabled = true;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "로딩중...";

        const { cacheHit } = await ensureLoaded({
            onBackgroundRefreshError: (err) => console.log("백그라운드 갱신 실패:", err),
        });

        console.log(cacheHit ? "⚡ 캐시로 즉시 활성화" : "✅ 최신 데이터 로드 완료");

        elements.searchBtn.disabled = false;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "조 확인하기";
    } catch (error) {
        console.log("❌ 데이터 로드 실패:", error);
        alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
        if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
    }
}

// 4. 검색 로직
function searchMember() {
    const name = elements.nameInput.value.trim().replace(/\s/g, '');
    const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    const member = findMember(name, phone);

    if (member) {
        // 찾은 경우에만 기억한다. 오타를 기억해 두면 다음에도 못 찾는다.
        saveLastSearch(name, phone);
        if (elements.clearRememberedBtn) elements.clearRememberedBtn.style.display = 'block';
        displayResult(member);
    } else {
        showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
    }
}

// 5. 검색 결과 표시
function toggleRow(row, value, target) {
    if (value && value.trim() !== "") {
        target.textContent = value;
        if (row) row.style.display = 'flex';
    } else {
        if (row) row.style.display = 'none';
    }
}

function displayResult(member) {
    elements.errorMessage.style.display = 'none';
    
    const memberListContainer = document.getElementById('teamMemberListContainer');
    if (memberListContainer) memberListContainer.style.display = 'none';

    const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
    const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
    const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
    const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null;

    toggleRow(nameRow, member.name, elements.resultName);
    toggleRow(teamRow, member.team, elements.resultTeam);
    toggleRow(locationRow, member.location, elements.resultLocation);
    
    const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
    toggleRow(lunchRow, lunchStatus, elements.resultLunch);

    // ✨ 텔레그램 링크 동적 렌더링
    let telegramRow = document.getElementById('telegramRow');
    if (!telegramRow && teamRow) {
        telegramRow = teamRow.cloneNode(true);
        telegramRow.id = 'telegramRow';

        if (telegramRow.children.length >= 2) {
            const label = telegramRow.children[0];
            if(label) label.textContent = '안내방';

            const valueContainer = telegramRow.children[1];
            if(valueContainer) {
                valueContainer.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 8px; align-items: stretch;">
                        <a id="resultTelegramLink" href="" target="_blank" class="telegram-btn">
                            <span style="font-size: 1.1em;">✈️</span>
                            <span id="telegramLinkText"></span>
                        </a>
                        <a id="resultGroupTelegramLink" href="" target="_blank" class="telegram-btn" style="display: none;">
                            <span style="font-size: 1.1em;">✈️</span>
                            <span id="groupTelegramLinkText"></span>
                        </a>
                    </div>
                `;
                valueContainer.id = '';
            }
        }
        teamRow.parentNode.insertBefore(telegramRow, teamRow.nextSibling);
    }

    const telegramLinkEl = document.getElementById('resultTelegramLink');
    const telegramTextEl = document.getElementById('telegramLinkText');
    if (telegramRow && telegramLinkEl && telegramTextEl) {
        if (member.telegramLink && member.team) {
            telegramLinkEl.href = member.telegramLink;
            telegramTextEl.textContent = `${member.team}조 방 입장하기`;
            telegramRow.style.display = 'flex';
        } else {
            telegramRow.style.display = 'none';
        }
    }

    // 조 이름 앞 접두사에 따라 소속 그룹 안내방 버튼 추가
    const GROUP_PREFIX_MAP = [
        { prefix: 'Y', group: '청년부' },
        { prefix: 'O', group: '온라인' },
        { prefix: 'C', group: '청년부부' },
        { prefix: '남', group: '남장년부' },
        { prefix: '여', group: '여장년부' }
    ];

    const groupTelegramLinkEl = document.getElementById('resultGroupTelegramLink');
    const groupTelegramTextEl = document.getElementById('groupTelegramLinkText');
    if (groupTelegramLinkEl && groupTelegramTextEl) {
        let matchedGroup = null;
        const teamName = member.team ? member.team.trim() : '';
        if (teamName) {
            for (const { prefix, group } of GROUP_PREFIX_MAP) {
                if (teamName.startsWith(prefix) && teamName !== group) {
                    matchedGroup = group;
                    break;
                }
            }
        }

        if (matchedGroup) {
            const groupLink = getTeamLink(matchedGroup);
            if (groupLink) {
                groupTelegramLinkEl.href = groupLink;
                groupTelegramTextEl.textContent = `${matchedGroup} 방 입장하기`;
                groupTelegramLinkEl.style.display = '';
            } else {
                groupTelegramLinkEl.style.display = 'none';
            }
        } else {
            groupTelegramLinkEl.style.display = 'none';
        }
    }

    const mapUrl = getLocationImage(member.location);
    if (mapUrl) {
        elements.mapImage.src = mapUrl;
        elements.mapContainer.style.display = 'block';
    } else {
        elements.mapContainer.style.display = 'none';
    }

    const isTutor = member.role && (
        member.role.includes('조장') ||
        member.role.includes('서브튜터') ||
        member.role.includes('관리자')
    );

    if (isTutor && member.team && memberListContainer) {
        // 지금 누구를 보고 있는지 기억해 둔다. 배경 갱신이 끝나면 이 값으로 다시 그린다.
        shownMember = member;
        renderTeamMembers(getTeamMembers(member.team), member.team, member.role);

        // 출결의 원본은 시트다. DB 는 동기화 간격만큼 뒤처지므로, 조원 명단을
        // 열 때는 원본을 읽어 방금 체크한 것이 보이게 한다.
        // 회차 목록도 같이 오므로 왕복은 한 번이면 된다.
        refreshAttendance()
            .then(() => renderTeamMembers(getTeamMembers(member.team), member.team, member.role))
            .catch(err => console.log("출결 최신화 실패, 마지막 값 표시:", err));
    } else {
        shownMember = member;
    }

    // 본인 출석 현황은 조장·조원 모두에게 보여준다.
    renderMyAttendance(member);
    renderMyHomework(member);

    elements.resultContainer.style.display = 'block';
    elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
}

// 지금 결과 카드에 떠 있는 사람. 배경 갱신이 끝나면 이 값으로 다시 그린다.
let shownMember = null;

// 6-1. 회차 선택
//
// 회차를 앱이 정해서 보낸다. 서버 시계에 맡기면 10일에 9일 출석을 찍을 때
// 10일 열이 새로 생긴다. 목록은 시트에 이미 있는 회차만이고,
// 아직 지나지 않은 회차는 데이터 계층이 걸러 준다.
function renderSessionPicker() {
    const row = document.getElementById('sessionPickerRow');
    const select = document.getElementById('sessionPicker');
    if (!row || !select) return;

    const sessions = getSessions();
    if (!sessions.length) {
        row.style.display = 'none';
        return;
    }

    row.style.display = 'flex';
    const current = getSession();

    // 최근 회차를 위로 (조장은 대개 방금 지난 회차를 본다)
    select.innerHTML = [...sessions].reverse().map(s =>
        `<option value="${escapeAttr(s.date)}"${s.date === current ? ' selected' : ''}>${escapeHtml(s.key)}</option>`
    ).join('');
}

// 5-1. 본인 출석 현황
//
// 조원도 자기 이력은 볼 수 있어야 한다. 조 전체 출석표는 조장 것이다.
// 지나간 회차만 그린다 — 아직 오지 않은 회차를 '기록 없음' 으로 보여주면
// 빠뜨린 것처럼 읽힌다.
async function renderMyAttendance(member) {
    const section = document.getElementById('myAttendanceSection');
    const grid = document.getElementById('myAttendanceGrid');
    const summary = document.getElementById('myAttendanceSummary');
    if (!section || !grid) return;

    section.style.display = 'none';

    let rows;
    try {
        rows = await getMyAttendance(member);
    } catch (err) {
        console.log('본인 출석 조회 실패:', err);
        return;
    }
    if (!rows.length) return;

    // 화면이 다른 사람으로 넘어갔으면 늦게 온 응답은 버린다.
    if (!shownMember || shownMember.id !== member.id) return;

    const present = rows.filter(r => r.status.toUpperCase() === 'O').length;
    const absent = rows.filter(r => r.status.toUpperCase() === 'X').length;
    const other = rows.length - present - absent;
    const lunchCount = rows.filter(r => r.lunch).length;
    const hwCount = rows.filter(r => r.homework).length;

    if (summary) {
        summary.textContent = [
            `총 ${rows.length}회차`,
            `출석 ${present}`,
            `결석 ${absent}`,
            other ? `그 외 ${other}` : '',
            lunchCount ? `🍙 ${lunchCount}회 신청` : '',
            hwCount ? `📝 ${hwCount}건 제출` : '',
        ].filter(Boolean).join(' · ');
    }

    grid.innerHTML = rows.map(r => {
        const st = classifyStatus(r.status);
        const badges = (r.lunch ? '🍙' : '') + (r.homework ? '📝' : '');
        const tip = [r.key, r.name, st.title,
                     r.lunch ? '🍙 김밥 신청' : '', r.homework ? '📝 과제 제출' : '']
                    .filter(Boolean).join(' · ');

        return `<div class="att-chip ${st.cls}" title="${escapeAttr(tip)}">
                    <span class="att-date">${escapeHtml(r.key)}</span>
                    ${r.name ? `<span class="att-name">${escapeHtml(r.name)}</span>` : ''}
                    <span class="att-mark">${escapeHtml(st.label)}</span>
                    <span class="att-badges">${badges}</span>
                </div>`;
    }).join('');

    section.style.display = 'block';
    renderMyLunch(rows);
}

// 5-1-1. 김밥 신청 요약
//
// 그리드의 🍙 만으로는 "몇 번 신청했는지" 가 한눈에 안 들어온다.
// 출석 조회에서 이미 받아온 값을 다시 쓰므로 통신이 늘지 않는다.
function renderMyLunch(rows) {
    const section = document.getElementById('myLunchSection');
    const badge = document.getElementById('myLunchBadge');
    const list = document.getElementById('myLunchList');
    if (!section || !badge || !list) return;

    const applied = rows.filter(r => r.lunch);

    badge.innerHTML = applied.length
        ? `<span class="lunch-total-badge">🍙 총 ${applied.length}회 신청</span>`
        : `<span class="lunch-total-badge none">신청 내역 없음</span>`;

    // 최근 회차가 앞으로 (조회하는 사람은 대개 최근 것을 궁금해한다)
    list.innerHTML = [...applied].reverse().map(r => `
        <span class="lunch-chip">
            ${r.name ? `<b>${escapeHtml(r.name)}</b>` : ''}
            <span class="lunch-chip-date">${escapeHtml(r.key)}</span>
        </span>
    `).join('');

    section.style.display = 'block';
}

// 5-2. 본인 과제 제출
//
// '몇 강' 을 회차 날짜에 짝지우지 않는다. 시트가 그 대응을 말해주지 않아서
// 순서로 짐작하면 엉뚱한 회차에 붙는다. 적힌 그대로 보여준다.
async function renderMyHomework(member) {
    const section = document.getElementById('myHomeworkSection');
    const list = document.getElementById('myHomeworkList');
    const summary = document.getElementById('myHomeworkSummary');
    if (!section || !list) return;

    section.style.display = 'none';

    let rows;
    try {
        rows = await getMyHomework(member);
    } catch (err) {
        console.log('본인 과제 조회 실패:', err);
        return;
    }
    if (!rows.length) return;
    if (!shownMember || shownMember.id !== member.id) return;

    if (summary) summary.textContent = `총 ${rows.length}건 제출`;

    // 한 줄에 하나씩. 18건이 카드로 쌓이면 화면이 통째로 밀린다.
    // 링크는 글씨 대신 🔗 로 — 다크모드에서 파란 글씨가 배경에 묻힌다.
    list.innerHTML = rows.map(r => {
        const when = r.submittedAt ? String(r.submittedAt).slice(0, 10) : '';
        const isLink = /^https?:\/\//i.test(r.content);

        return `
            <div class="hw-row">
                <span class="hw-lecture">${escapeHtml(r.lecture || '(미기재)')}</span>
                <span class="hw-kind">${escapeHtml(r.kind || '')}</span>
                <span class="hw-when">${escapeHtml(when)}</span>
                <span class="hw-links">${
                    isLink
                        ? `<a href="${escapeAttr(r.content)}" target="_blank" rel="noopener"
                              title="제출물 열기" aria-label="제출물 열기">🔗</a>`
                        : (r.content ? `<span title="${escapeAttr(r.content)}">📄</span>` : '')
                }</span>
            </div>
        `;
    }).join('');

    section.style.display = 'block';
}

// 6-2. 조 요약 — 총원 · 출석 · 결석 · 김밥
//
// '돌봄' 같은 시트 표기는 출석도 결석도 아니라서 따로 센다.
// 결석으로 묶으면 조장이 "왜 결석이 이렇게 많지" 하고 잘못 읽는다.
function renderTeamSummary(members) {
    const el = document.getElementById('teamSummaryCard');
    if (!el) return;

    const up = (v) => String(v || '').trim().toUpperCase();
    const present = members.filter(m => up(m.attendance) === 'O').length;
    const absent = members.filter(m => up(m.attendance) === 'X').length;
    const other = members.length - present - absent;
    const kimbap = members.filter(m => up(m.lunch) === 'O').length;

    const stat = (cls, value, label) => `
        <div class="stat ${cls}">
            <div class="stat-value">${value}</div>
            <div class="stat-label">${label}</div>
        </div>`;

    el.innerHTML = stat('', members.length, '총원')
        + stat('present', present, '✅ 출석')
        + stat('absent', absent, '❌ 결석')
        + (other ? stat('special', other, '📌 그 외') : '')
        + stat('lunch', kimbap, '🍙 김밥');
}

// 6. 직책별 우선순위 설정
const rolePriority = {
    "관리자": 1,
    "조장": 2,
    "서브튜터": 3,
    "조원": 4,
    "": 4
};

// 7. 조원 목록 그리기
function renderTeamMembers(members, teamName, role) {
    const listElement = document.getElementById('teamMemberList');
    const titleElement = document.getElementById('teamListTitle');
    const container = document.getElementById('teamMemberListContainer'); 
    
    if (!listElement || !titleElement || !container) return;

    if (!role || role.trim() === '') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    // 총원·김밥은 제목이 아니라 요약 카드에 둔다.
    // 제목이 길면 '전체 출석표' 버튼이 다음 줄로 밀린다.
    titleElement.textContent = `👥 ${teamName} 조원 명단`;

    renderSessionPicker();
    renderTeamSummary(members);

    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        return a.name.localeCompare(b.name, 'ko');
    });

    listElement.innerHTML = sortedMembers.map((m) => {
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        const status = String(m.attendance || '').trim();

        // 시트에 '돌봄' · '-' 처럼 O/X 가 아닌 표기가 있으면 체크박스를 두지 않는다.
        // 체크박스로 두면 '체크 안 됨' 으로 보여서, 조장이 무심코 눌러 그 기록을
        // O 로 덮어 버린다. 바꿔야 한다면 시트에서 직접 고치는 게 맞다.
        const isPlain = status === '' || status.toUpperCase() === 'O' || status.toUpperCase() === 'X';

        const checked = status.toUpperCase() === 'O';
        const control = isPlain
            ? `<input type="checkbox" ${checked ? 'checked' : ''}
                    class="attendance-check"
                    data-name="${escapeAttr(m.name)}" data-phone="${escapeAttr(m.phone)}"
                    data-initial="${checked ? '1' : '0'}">`
            : `<span class="attendance-badge" title="시트에 적힌 표기입니다. 바꾸려면 시트에서 고치세요.">${escapeHtml(status)}</span>`;

        return `
            <div class="team-member-item">
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${control}
                    <span class="member-name">
                        ${escapeHtml(m.name)}(${escapeHtml(m.phone)}) ${lunchIcon}
                    </span>
                </div>
                <span class="member-role-tag">
                    ${escapeHtml(m.role || '조원')}
                </span>
            </div>
        `;
    }).join('');

    setupSaveBar();
}

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
const escapeAttr = escapeHtml;

// ============================================================================
// 출결 일괄 저장
//
// 체크할 때마다 보내지 않는다. 조장은 명단을 훑으며 여러 명을 고치는데,
// 누를 때마다 저장하면 되돌리기 어렵고 통신도 그만큼 늘어난다.
// 무엇이 몇 건 바뀌는지 보여주고, 버튼을 눌렀을 때 바뀐 사람만 보낸다.
// ============================================================================

function attendanceChecks() {
    return Array.from(document.querySelectorAll('#teamMemberList .attendance-check'));
}

function changedChecks() {
    return attendanceChecks().filter(cb => (cb.checked ? '1' : '0') !== cb.dataset.initial);
}

function refreshSaveBar() {
    const bar = document.getElementById('attendanceSaveBar');
    const btn = document.getElementById('saveAttendanceBtn');
    const info = document.getElementById('attendanceSaveInfo');
    if (!bar || !btn || !info) return;

    const checks = attendanceChecks();
    const present = checks.filter(cb => cb.checked).length;
    const changes = changedChecks().length;

    info.textContent = `출석 ${present} · 결석 ${checks.length - present}`
        + (changes ? ` · 변경 ${changes}건` : '');
    btn.disabled = changes === 0;
    btn.textContent = changes === 0 ? '변경 사항 없음' : `출석 반영 (${changes}건)`;
    bar.classList.toggle('has-changes', changes > 0);
}

function setupSaveBar() {
    const bar = document.getElementById('attendanceSaveBar');
    if (!bar) return;
    bar.style.display = 'flex';
    for (const cb of attendanceChecks()) cb.addEventListener('change', refreshSaveBar);
    refreshSaveBar();
}

async function saveAttendanceChanges() {
    const btn = document.getElementById('saveAttendanceBtn');
    const info = document.getElementById('attendanceSaveInfo');
    const session = getSession();

    const changed = changedChecks();
    if (!changed.length || !btn) return;

    if (!session) {
        alert('회차를 알 수 없어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }

    // 바뀐 사람만 보낸다. 전원을 O/X 로 보내면 시트에 사람이 직접 넣은
    // 다른 표기가 한 번에 지워진다.
    const changes = changed.map(cb => ({
        name: cb.dataset.name,
        phone: cb.dataset.phone,
        status: cb.checked ? 'O' : 'X',
    }));

    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '저장 중…';

    try {
        const { saved, kept, missing } = await saveAttendance(session, changes);

        // 저장된 것만 새 기준선으로 삼는다
        for (const cb of changed) cb.dataset.initial = cb.checked ? '1' : '0';

        const notes = [];
        if (kept && kept.length) notes.push(`다른 표기가 있어 두었습니다: ${kept.join(', ')}`);
        if (missing && missing.length) notes.push(`명단에 없습니다: ${missing.join(', ')}`);

        // 끝났는데 '저장 중…' 이 남아 있으면 진행 중인 줄 안다.
        btn.textContent = '✅ 저장됨';

        // 요약 숫자도 같이 맞춘다 (명단은 그대로 두고 카드만).
        if (shownMember) renderTeamSummary(getTeamMembers(shownMember.team));
        if (info) info.textContent = `✅ ${session} ${saved}건 저장 완료`;
        if (notes.length) alert(notes.join('\n'));

        setTimeout(refreshSaveBar, 2500);
    } catch (error) {
        console.log('출결 저장 실패:', error);
        alert('출결 저장에 실패했습니다: ' + error.message);
        btn.textContent = prevText;
        btn.disabled = false;
    }
}

// ============================================================================
// 조 전체 출석표
//
// 명단 화면은 한 회차만 보여준다. 조장이 흐름을 보려면 회차를 하나씩
// 바꿔가며 봐야 해서, 조원 전체 × 회차를 한 표에 펼친다.
//
// 칸 하나에 세 가지가 겹친다 — 출결 · 김밥(🍙) · 과제(📝).
// 셋의 키가 서로 다르다는 게 이 화면에서 제일 잘 틀리는 지점이다.
//
//   출결 = ISO 날짜   (attendanceByDate['2026-08-09'])
//   김밥 = ISO 날짜   (dg_lunch.session_date)
//   과제 = 강의명     (dg_homework.lecture — '18강')
//
// 그래서 컬럼이 date 와 name 을 같이 들고 있어야 한다. 하나로 합치려 들면
// 대응이 어긋나고, 어긋나도 오류가 안 나서 📝 가 한 번도 안 뜬다.
// ============================================================================

// 시트 값을 표시용으로 나눈다. O·X 말고도 사람이 적은 표기가 들어온다.
function classifyStatus(raw) {
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

// 회차를 컬럼으로 바꾼다. 두 키(date · name)를 같이 들고 다니는 게 핵심이다.
function buildSessionColumns() {
    return getSessions()
        .map(s => ({
            date: s.date,                    // ← 출결·김밥을 찾을 키
            key: s.key,                      // ← 화면에 찍는 MM/DD
            name: s.name || '',              // ← 과제를 찾을 키
            isClass: isClassSession(s.name), // ← '자유교제' 같은 회차는 흐리게
        }))
        .filter(c => c.date);
}

// extras 는 getTeamExtras() 결과. 없으면 뱃지 없이 그대로 그린다
// (모달을 여는 순간 표는 뜨고, 김밥·과제는 도착하는 대로 다시 그린다).
function renderTeamMatrix(teamName, members, extras) {
    const scrollEl = document.getElementById('matrixScroll');
    const titleEl = document.getElementById('matrixTitle');
    if (!scrollEl) return;

    const cols = buildSessionColumns();
    if (titleEl) titleEl.textContent = `👥 ${teamName} 전체 출석표 (${members.length}명 · ${cols.length}회차)`;

    const lunchMap = extras?.lunch || new Map();
    const hwMap = extras?.homework || new Map();

    const sorted = [...members].sort((a, b) => {
        const pa = rolePriority[a.role] || 4;
        const pb = rolePriority[b.role] || 4;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name, 'ko');
    });

    const headRow = cols.map(c =>
        `<th class="${c.isClass ? '' : 'non-class'}">
            <span class="mx-session">${escapeHtml(c.name || '-')}</span>
            <span class="mx-date">${escapeHtml(c.key)}</span>
        </th>`
    ).join('');

    const bodyRows = sorted.map(m => {
        const att = m.attendanceByDate || {};
        const present = cols.filter(c => String(att[c.date] || '').toUpperCase() === 'O').length;
        const myLunch = lunchMap.get(m._uuid) || null;
        const myHw = hwMap.get(m._uuid) || null;

        const cells = cols.map(c => {
            const st = classifyStatus(att[c.date]);
            const lunch = !!(myLunch && myLunch.has(c.date));
            // 회차에 강의명이 없으면 과제를 붙일 근거가 없다. 순서로 짐작하지 않는다.
            const homework = !!(myHw && c.name && myHw.has(normalizeLectureKey(c.name)));

            const badges = (lunch ? '🍙' : '') + (homework ? '📝' : '');
            const tip = [m.name, c.key, c.name, st.title,
                         lunch ? '🍙 김밥 신청' : '', homework ? '📝 과제 제출' : '']
                        .filter(Boolean).join(' · ');

            return `<td class="mx-cell ${st.cls}${c.isClass ? '' : ' non-class'}" title="${escapeAttr(tip)}">
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

    scrollEl.innerHTML = `
        <table class="matrix-table">
            <thead><tr><th class="mx-name-cell mx-corner">조원</th>${headRow}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>
    `;
}

// 데이터 계층의 정규화와 같은 규칙. 회차 이름(시트)과 과제 이름(폼)이
// 서로 다르게 적히므로 양쪽을 같은 모양으로 만든 뒤에 견준다.
function normalizeLectureKey(v) {
    const raw = String(v || '').replace(/\s/g, '');
    const m = raw.match(/^제?(\d+)강/);
    if (m) return m[1] + '강';
    if (/^자유교재/.test(raw)) return '자유교제';
    if (/^교재/.test(raw)) return '교제';
    return raw.toLowerCase();
}

let matrixToken = 0;

function openMatrixModal() {
    if (!shownMember || !shownMember.team) return;
    const team = shownMember.team;
    const members = getTeamMembers(team);

    // 표부터 띄운다. 김밥·과제를 기다리느라 버튼이 먹통처럼 보이면 안 된다.
    renderTeamMatrix(team, members, null);

    const modal = document.getElementById('matrixModal');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const token = ++matrixToken;
    getTeamExtras(members)
        .then(extras => {
            // 그새 닫혔거나 다른 조를 열었으면 늦게 온 응답은 버린다.
            if (token !== matrixToken || !modal.classList.contains('active')) return;
            renderTeamMatrix(team, members, extras);
        })
        .catch(err => console.log('조 김밥·과제 조회 실패:', err));
}

function closeMatrixModal() {
    const modal = document.getElementById('matrixModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'auto';
}

// 8. 에러 표시 함수
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 9. 이벤트 리스너 및 모달 제어
function initEventListeners() {
    elements.searchBtn.addEventListener('click', searchMember);
    elements.closeBtn.addEventListener('click', () => { elements.resultContainer.style.display = 'none'; });
    elements.themeToggle.addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });
    elements.adminBtn.addEventListener('click', () => { elements.adminModal.classList.add('active'); });
    elements.adminClose.addEventListener('click', () => { elements.adminModal.classList.remove('active'); });
    elements.adminForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('adminId').value;
        const pw = document.getElementById('adminPassword').value;
        if (id === 'plc' && pw === 'plc1234') {
            alert("로그인 성공!");
            sessionStorage.setItem('adminLoggedIn', 'true'); 
            window.location.href = 'admin.html'; 
        } else {
            const errorElement = document.getElementById('adminLoginError');
            errorElement.style.display = 'block';
            errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
        }
    });
    elements.phoneInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !elements.searchBtn.disabled) searchMember();
    });

    // '다른 사람으로 조회' — 기억한 값 지우기
    if (elements.clearRememberedBtn) {
        elements.clearRememberedBtn.addEventListener('click', () => {
            clearLastSearch();
            elements.nameInput.value = '';
            elements.phoneInput.value = '';
            elements.clearRememberedBtn.style.display = 'none';
            elements.resultContainer.style.display = 'none';
            elements.nameInput.focus();
        });
    }

    // 회차 변경
    const picker = document.getElementById('sessionPicker');
    if (picker) {
        picker.addEventListener('change', (e) => {
            // 저장하지 않은 변경이 있으면 회차를 바꿀 때 사라진다. 먼저 묻는다.
            const pending = changedChecks().length;
            if (pending && !confirm(`저장하지 않은 변경 ${pending}건이 있습니다. 버리고 회차를 바꿀까요?`)) {
                e.target.value = getSession();
                return;
            }
            setSession(e.target.value);
            if (shownMember) {
                renderTeamMembers(getTeamMembers(shownMember.team), shownMember.team, shownMember.role);
            }
        });
    }

    // 출결 일괄 저장
    const saveBtn = document.getElementById('saveAttendanceBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAttendanceChanges);

    // 전체 출석표
    const matrixBtn = document.getElementById('openMatrixBtn');
    if (matrixBtn) matrixBtn.addEventListener('click', openMatrixModal);

    const matrixClose = document.getElementById('matrixCloseBtn');
    if (matrixClose) matrixClose.addEventListener('click', closeMatrixModal);

    const matrixModal = document.getElementById('matrixModal');
    if (matrixModal) {
        matrixModal.addEventListener('click', (e) => {
            if (e.target === matrixModal) closeMatrixModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMatrixModal();
    });
}

function initModal() {
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const mapImage = document.getElementById('mapImage');
    const modalClose = document.getElementById('modalClose');
    if (!mapImage) return;
    mapImage.addEventListener('click', () => {
        modalImage.src = mapImage.src;
        imageModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
    function closeModal() {
        if(imageModal) {
            imageModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }
    if (imageModal) imageModal.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

// 10. 자동 업데이트
//
// 사용자는 아무것도 누르지 않는다. 새 버전이 감지되면 짧게 알리고 스스로 리로드한다.
// "새로고침 하세요" 안내를 두지 않는 이유: 고령 사용자가 많아 누르지 않는다.

function showUpdateToast(message) {
    let toast = document.getElementById('swUpdateToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'swUpdateToast';
        toast.className = 'sw-update-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
}

// 우리가 갱신을 적용시켰는지. controllerchange 가 '첫 설치의 claim' 인지
// '새 버전 적용' 인지 가르는 기준이다.
let updateApplied = false;

function applyUpdate(worker) {
    updateApplied = true;
    showUpdateToast('🎉 새 버전을 적용하는 중이에요…');
    // 잠깐 보여준 뒤 적용 (controllerchange → 자동 리로드)
    setTimeout(() => worker.postMessage({ type: 'SKIP_WAITING' }), 600);
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:'
        && location.hostname !== 'localhost'
        && location.hostname !== '127.0.0.1') return;

    window.addEventListener('load', async () => {
        // 지금 이 페이지가 SW 의 제어를 받고 있었는가.
        // 첫 방문이면 false 다 — activate 의 clients.claim() 이 controllerchange 를
        // 일으키는데, 그때 리로드하면 처음 들어온 사람 화면이 이유 없이 깜빡인다.
        const hadController = !!navigator.serviceWorker.controller;

        try {
            const registration = await navigator.serviceWorker.register('sw.js');

            // 이미 대기 중인 새 버전이 있으면 바로 적용
            if (registration.waiting && navigator.serviceWorker.controller) {
                applyUpdate(registration.waiting);
            }

            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    // controller 가 있어야 '갱신'이다. null 이면 첫 방문이라
                    // 여기서 리로드하면 처음 들어온 사람 화면이 이유 없이 깜빡인다.
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        applyUpdate(newSW);
                    }
                });
            });

            // sw.js 자체도 캐시되므로 주기적으로 확인한다.
            // registration.update() 는 브라우저 HTTP 캐시를 우회한다.
            setInterval(() => registration.update(), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update();
            });

            // 새 SW 가 페이지를 넘겨받으면 리로드.
            // 플래그가 없으면 리로드 → 또 넘겨받음 → 리로드 로 무한히 돈다.
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // 첫 설치의 clients.claim() 도 이 이벤트를 일으킨다. 그때는 갱신이
                // 아니라 첫 방문이므로 리로드하지 않는다.
                //
                // updateApplied  우리가 새 버전을 적용시킨 경우 (첫 방문 세션 중
                //                배포가 나가도 여기에 걸린다)
                // hadController  다른 탭이 적용시켜 넘어온 경우
                if (!updateApplied && !hadController) return;
                if (reloading) return;
                reloading = true;
                window.location.reload();
            });
        } catch (err) {
            console.log('SW 등록 실패:', err);
        }
    });
}
registerServiceWorker();

// 11. 갱신되면 화면을 다시 그린다
//
// 캐시로 먼저 그리고 뒤에서 새로 받아오는 구조라, 갱신이 끝났을 때 다시 그리지
// 않으면 화면에는 옛 값이 남는다. 조원 명단처럼 로드 시점 값을 붙들고 있는
// 화면이 특히 위험하다 — 보는 사람은 그게 옛 데이터인 줄 모른다.
function rerenderShown() {
    if (!shownMember || elements.resultContainer.style.display === 'none') return;

    // 갱신된 목록에서 같은 사람을 다시 찾는다 (조·역할이 바뀌었을 수 있다).
    const fresh = findMember(shownMember.name, shownMember.phone) || shownMember;
    displayResult(fresh);
}

subscribe((event) => {
    if (event.type === 'refresh' || event.type === 'cohort-changed') rerenderShown();
});

// 12. 실행
window.addEventListener('load', () => {
    loadData();
    initEventListeners();
    initModal();
    applyLastSearch();
});
