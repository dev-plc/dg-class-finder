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
    ensureSession,
    compareLeadFirst,
    getTeamAttendance,
    getTeamExtras,
    getUpcomingLunches,
    homeworkKindLabel,
    homeworkRule,
    isAbsent,
    isClassSession,
    isPastSession,
    isPresent,
    loadAttendanceForSession,
    saveAttendance,
    splitSubmissionLinks,
    subscribe,
    startAutoRefresh,
} from './scripts/members-data.js?v=134';

import { classifyStatus, renderTeamMatrixHTML } from './scripts/matrix-renderer.js?v=134';
import { adminSignIn } from './scripts/admin-auth.js?v=134';

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
    // 폰 자판에서 전각 숫자·영문이 들어오는 일이 있다 ('１１１１').
    // 여기서 반각으로 바꾸지 않으면 아래에서 숫자가 아니라고 통째로 지워져,
    // 번호를 분명히 넣었는데 '번호를 입력해주세요' 가 뜬다.
    const half = (v) => String(v || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g,
        (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const name = half(elements.nameInput.value).trim().replace(/\s/g, '');
    const phone = half(elements.phoneInput.value).trim().replace(/[^0-9]/g, '');

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

    // 안내방은 둘이다 — 소속 부서 방과 자기 조 방. 줄을 나눠 각각 이름표를 단다.
    //
    //   안내방   ✈️ 온라인DG 안내방 입장하기
    //   조별방   ✈️ O1조 방 입장하기
    //
    // 한 줄에 묶어 두면 어느 버튼이 무엇인지 눌러 보기 전에는 모른다.
    // 두 줄을 따로 켜고 끈다 — 예전에는 조 방 링크가 없으면 줄을 통째로 감춰서
    // 부서 방까지 같이 사라졌다.
    //
    // key 는 시트(DG링크 탭)에 적힌 이름이고, label 은 버튼에 찍는 이름이다.
    // 둘을 하나로 두면 버튼 글자를 바꾸는 순간 링크를 못 찾는다.
    const GROUP_PREFIX_MAP = [
        { prefix: 'Y', key: '청년부',   label: '청년부' },
        { prefix: 'O', key: '온라인',   label: '온라인DG' },
        { prefix: 'C', key: '청년부부', label: '청년부부' },
        { prefix: '남', key: '남장년부', label: '남장년부' },
        { prefix: '여', key: '여장년부', label: '여장년부' }
    ];

    const teamName = member.team ? member.team.trim() : '';
    const teamLink = teamName ? member.telegramLink : '';

    // 조 이름 앞 글자로 소속 부서를 고른다. 이름이 곧 부서인 줄(예: '온라인')은
    // 자기 자신을 가리키므로 뺀다.
    let matchedGroup = null;
    for (const g of GROUP_PREFIX_MAP) {
        if (teamName.startsWith(g.prefix) && teamName !== g.key && teamName !== g.label) {
            matchedGroup = g;
            break;
        }
    }
    // 시트에 어느 이름으로 적혀 있어도 찾도록 둘 다 본다.
    const groupLink = matchedGroup
        ? (getTeamLink(matchedGroup.label) || getTeamLink(matchedGroup.key) || '')
        : '';

    // 줄은 '조' 줄을 본떠 만든다. 정보 줄의 생김새(라벨 폭·정렬)를 따로 적어 두면
    // 나중에 카드 디자인을 고칠 때 이 줄만 어긋난다.
    function ensureRoomRow(id, label, linkId, textId, after) {
        let row = document.getElementById(id);
        if (row) return row;
        if (!teamRow || !after) return null;

        row = teamRow.cloneNode(true);
        row.id = id;
        const labelEl = row.children[0];
        const valueEl = row.children[1];
        if (labelEl) labelEl.textContent = label;
        if (valueEl) {
            valueEl.id = '';
            valueEl.innerHTML = `
                <a id="${linkId}" href="" target="_blank" class="telegram-btn">
                    <span style="font-size: 1.1em;">✈️</span>
                    <span id="${textId}"></span>
                </a>`;
        }
        after.parentNode.insertBefore(row, after.nextSibling);
        return row;
    }

    // 부서 방이 위, 조 방이 아래.
    const groupRow = ensureRoomRow('groupRoomRow', '안내방',
        'resultGroupTelegramLink', 'groupTelegramLinkText', teamRow);
    const teamRoomRow = ensureRoomRow('teamRoomRow', '조별방',
        'resultTelegramLink', 'telegramLinkText', groupRow || teamRow);

    const showRoom = (row, linkId, textId, href, text) => {
        if (!row) return;
        const link = document.getElementById(linkId);
        const label = document.getElementById(textId);
        if (href && link && label) {
            link.href = href;
            label.textContent = text;
            row.style.display = 'flex';
        } else {
            row.style.display = 'none';
        }
    };

    showRoom(groupRow, 'resultGroupTelegramLink', 'groupTelegramLinkText',
             groupLink, `${matchedGroup?.label ?? ''} 안내방 입장하기`);
    showRoom(teamRoomRow, 'resultTelegramLink', 'telegramLinkText',
             teamLink, `${teamName}조 방 입장하기`);

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
        showTeamAttendance();
    } else {
        shownMember = member;
        // 조장 명단을 받던 중이었으면 그 응답은 버린다 — 조원 화면에 명단이 뜨면 안 된다.
        teamAttToken++;
    }

    // 본인 출석 현황은 조장·조원 모두에게 보여준다.
    // 과제 쪽은 출결 행(회차 이름 · 📝 여부)이 있어야 '안 낸 것' 을 셀 수 있어
    // 이어 붙인다. 따로 부르면 같은 조회를 두 번 하게 된다.
    renderMyAttendance(member)
        .then(rows => renderMyHomework(member, rows))
        .catch(err => console.log('본인 현황 표시 실패:', err));

    elements.resultContainer.style.display = 'block';
    elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
}

// 지금 결과 카드에 떠 있는 사람. 배경 갱신이 끝나면 이 값으로 다시 그린다.
let shownMember = null;

// 6-0. 조원 명단의 출결 — DB 에서 **한 조 · 한 회차**만
//
// 예전에는 GAS 로 시트 전체(261명 × 39회차, 탭 넷)를 읽었다. 한 번에 11~102초.
// 그동안 로딩 표시가 없어서 조장은 빈 명단에 체크를 시작했고, 응답이 오면 명단을
// 다시 그리면서 **그 체크가 말없이 사라졌다.** 회차도 그 응답이 와야 정해져서,
// 화면에는 11/01 이 보이는데 저장하면 '회차를 알 수 없어' 가 떴다.
//
// 지금은 회차를 먼저 정하고(ensureSession — 캐시로 즉시), 그 회차의 이 조만
// DB 에서 읽는다. 받는 동안은 체크·저장을 막고 그렇다고 말한다.
//
//   state  'loading' 받아 오는 중 — 체크박스 비활성, 저장 막음
//          'ready'   받아 왔다
//          'error'   못 받았다 — 다시 시도 버튼. 저장은 **계속 막는다**:
//                    빈 명단을 그대로 저장하면 전원이 X 로 나간다
const teamAtt = { team: '', session: '', state: 'loading' };
// 이 페이지에서 한 번 받아 온 (조, 회차). 다시 그릴 때는 기다리지 않고 바로 그리고
// 뒤에서 조용히 새로 읽는다 — 배경 갱신 때마다 명단이 '불러오는 중' 으로 깜빡이지 않게.
const teamAttLoaded = new Set();
let teamAttToken = 0;
let teamAttSaving = false;

function showTeamAttendance() {
    const member = shownMember;
    if (!member || !member.team) return;
    const team = member.team;
    const session = ensureSession();
    const key = `${team}|${session}`;
    const had = teamAttLoaded.has(key);

    teamAtt.team = team;
    teamAtt.session = session;
    // 회차가 하나도 없으면 받아 올 것도 없다 — 그대로 그린다 (선택칸도 숨는다).
    teamAtt.state = (had || !session) ? 'ready' : 'loading';
    renderTeamMembers(getTeamMembers(team), team, member.role);
    if (!session) return;

    // 그새 다른 사람을 조회했거나 회차를 바꿨으면 늦게 온 응답은 버린다.
    const token = ++teamAttToken;
    // 배경 갱신이 shownMember 를 같은 사람의 새 객체로 바꿔 둘 수 있다 — 아이디로 견준다.
    const redraw = () => {
        const cur = shownMember;
        if (!cur || cur.id !== member.id) return;
        renderTeamMembers(getTeamMembers(cur.team), cur.team, cur.role);
    };
    loadAttendanceForSession(session, { members: getTeamMembers(team) })
        .then(() => {
            teamAttLoaded.add(key);
            if (token !== teamAttToken) return;
            teamAtt.state = 'ready';
            redraw();
        })
        .catch(err => {
            console.log('조 출결 조회 실패:', err);
            if (token !== teamAttToken) return;
            // 이미 받아 둔 값으로 그려 놨으면 그대로 둔다 — 뒤에서 새로 읽던 것뿐이다.
            if (had) return;
            teamAtt.state = 'error';
            redraw();
        });
}

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
    // 늘 앱이 쥔 회차에 selected 를 붙인다. 안 붙이면 브라우저가 첫 항목을 보여줘서
    // **보이는 회차와 저장될 회차가 달라진다** (ensureSession 이 비지 않게 정한다).
    const current = getSession();

    // 최근 회차를 위로 (조장은 대개 방금 지난 회차를 본다)
    select.innerHTML = [...sessions].reverse().map(s =>
        `<option value="${escapeAttr(s.date)}"${s.date === current ? ' selected' : ''}>${escapeHtml(s.key)}</option>`
    ).join('');
}

// 최근 몇 회차를 펴 두는가. 나머지는 '이전 N회차 더 보기' 뒤로 접는다.
const MY_ATT_OPEN = 10;
// 과제는 다섯 건. 한 줄이 회차 칩보다 굵어서 같은 수만큼 펴 두면 더 길어 보인다.
const MY_HW_OPEN = 5;
// 김밥은 칩이 작아 여덟 개(세 줄쯤). 20회차가 넘어가면 이것만으로 화면이 밀린다.
const MY_LUNCH_OPEN = 8;

// 과제와 소감문 제출 폼. 화면 여러 곳에서 쓰지 않도록 한 곳에 둔다.
const HOMEWORK_FORM_URL = 'https://forms.gle/cnhxuonpz2tmMu2y9';

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
        return [];
    }
    if (!rows.length) return rows;

    // 화면이 다른 사람으로 넘어갔으면 늦게 온 응답은 버린다.
    if (!shownMember || shownMember.id !== member.id) return rows;

    // ⚠️ **세는 것은 지나간 회차뿐이다.** 그리드에는 다가오는 회차 한 칸이
    // 함께 그려지지만(매트릭스와 같은 규칙), 아직 오지 않은 주를 '총 회차' 나
    // 결석·미제출로 세면 안 된다.
    const past = rows.filter(r => !r.upcoming);

    // 시트가 '과제' 로 바꿔 둔 칸은 출석으로 센다 (docs/RULES.md).
    const present = past.filter(r => isPresent(r.status)).length;
    const absent = past.filter(r => isAbsent(r.status)).length;
    const other = past.length - present - absent;
    const lunchCount = past.filter(r => r.lunch).length;
    const hwCount = past.filter(r => r.homework).length;

    if (summary) {
        summary.textContent = [
            `총 ${past.length}회차`,
            `출석 ${present}`,
            `결석 ${absent}`,
            other ? `그 외 ${other}` : '',
            lunchCount ? `🍙 ${lunchCount}회 신청` : '',
            hwCount ? `📝 ${hwCount}건 제출` : '',
        ].filter(Boolean).join(' · ');
    }

    // 앞쪽(오래된) 회차를 접는다. 차례는 그대로 1강 → 최근이다 —
    // 최근 것만 남긴다고 순서를 뒤집으면 어느 회차인지 읽기 어려워진다.
    // 접는 것도 지난 회차만 센다. rows.length 로 세면 예정 칸이 자리를 차지해
    // 최근 10회차가 아니라 9회차만 펴진다.
    const folded = Math.max(0, past.length - MY_ATT_OPEN);

    grid.innerHTML = rows.map((r, i) => {
        const st = classifyStatus(r.status);
        // 결석인데 과제+소감문을 냈으면 전체 출석표와 **같은 모양**으로 보여준다.
        // 한쪽은 X, 한쪽은 '과제' 면 조원과 조장이 같은 칸을 두고 다른 말을 한다.
        // 시트가 이미 '과제' 로 바꾼 칸은 classifyStatus 가 makeup 으로 준다 —
        // 여기서 칠하는 것은 시트가 아직 못 잡은 칸이다 (docs/RULES.md).
        const isReplaced = st.cls === 'absent' && r.homework;
        const cls = isReplaced ? 'makeup' : st.cls;
        const label = isReplaced ? '과제' : st.label;
        const makeupCell = cls === 'makeup';
        // '과제+소감문' 이 아닌 제출(예습과제 등).
        const partKinds = r.homework ? [] : (r.homeworkKinds || []);
        // ⚠️ **소감문은 결석을 메우는 것**이다 (공지 규칙 5). 나온 주에는 요구할
        // 것이 아니므로, 종류가 모자라다고 흐리게 그리는 것은 **결석한 주에만**
        // 뜻이 있다. 출석한 주에 예습과제를 낸 것은 모자란 게 아니라 다 한 것이다.
        const lacking = st.cls === 'absent' && partKinds.length > 0;
        // 노란 칸에는 **언제나** 📝 — 전체 출석표와 같은 모양이다.
        // 시트의 '과제' 는 사람이 확인하고 찍은 값이라 제출 기록을 기다리지 않는다.
        // 기록은 동기화로만 와서 몇 시간 늦는다 (docs/RULES.md '노란 칸의 📝').
        const hwIcon = makeupCell ? '<span class="hw-badge">📝</span>'
                     : lacking ? '<span class="hw-partial">📝</span>'
                     : (r.homework || partKinds.length) ? '📝' : '';
        const badges = (r.lunch ? '🍙' : '') + hwIcon;
        const tip = [r.key, r.name,
                     isReplaced ? '결석 — 과제와 소감문으로 메움' : st.title,
                     r.lunch ? '🍙 김밥 신청' : '',
                     r.homework ? '📝 과제와 소감문 제출'
                     : makeupCell ? '📝 시트에 과제로 처리됨 (제출 기록은 아직 앱에 없음)'
                     : lacking ? `📝 ${homeworkKindLabel(partKinds)} 제출 (결석을 메우려면 과제와 소감문)`
                     : partKinds.length ? `📝 ${homeworkKindLabel(partKinds)} 제출` : '']
                    .filter(Boolean).join(' · ');

        // 아직 안 온 주는 흐리게, 표기 자리에 '예정' 을 적는다 (매트릭스와 같다).
        // 접히는 쪽에는 절대 넣지 않는다 — 지금 가장 궁금한 칸이다.
        return `<div class="att-chip ${r.upcoming ? 'upcoming' : cls}${!r.upcoming && i < folded ? ' old' : ''}" title="${escapeAttr(tip)}">
                    <span class="att-date">${escapeHtml(r.key)}</span>
                    ${r.name ? `<span class="att-name">${escapeHtml(r.name)}</span>` : ''}
                    <span class="att-mark">${r.upcoming ? '예정' : escapeHtml(label)}</span>
                    <span class="att-badges">${badges}</span>
                </div>`;
    }).join('');

    setMyAttFold(folded, false);

    section.style.display = 'block';

    // 다가오는 회차 신청은 rows 에 없다(지나간 회차만 담는다). 늦게 와도
    // 요약은 먼저 그린다 — 지난 이력만으로도 볼 것이 있다.
    renderMyLunch(rows, []);
    getUpcomingLunches(member)
        .then(ups => {
            if (!ups.length || !shownMember || shownMember.id !== member.id) return;
            renderMyLunch(rows, ups);
        })
        .catch(err => console.log('다가오는 김밥 조회 실패:', err));

    return rows;
}

/**
 * 지난 회차 접기·펼치기.
 *
 * 사람을 새로 조회할 때마다 접힌 채로 시작한다 — 펼친 상태를 기억하면
 * 다음 사람을 볼 때 또 화면을 다 먹는다.
 *
 * 버튼은 격자 위에 둔다. 접힌 회차가 격자 앞쪽(오래된 쪽)이라, 버튼이
 * 아래에 있으면 펼치는 순간 방금 누른 버튼이 화면 밖으로 밀려난다.
 */
function setMyAttFold(hidden, open) {
    const grid = document.getElementById('myAttendanceGrid');
    const btn = document.getElementById('myAttendanceMoreBtn');
    if (!grid || !btn) return;

    grid.classList.toggle('folded', hidden > 0 && !open);
    btn.hidden = hidden === 0;
    btn.dataset.hidden = String(hidden);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? `↑ 최근 ${MY_ATT_OPEN}회차만 보기`
                           : `↓ 이전 ${hidden}회차 더 보기`;
}

// 5-1-1. 김밥 신청 요약
//
// 그리드의 🍙 만으로는 "몇 번 신청했는지" 가 한눈에 안 들어온다.
// 출석 조회에서 이미 받아온 값을 다시 쓰므로 통신이 늘지 않는다.
function renderMyLunch(rows, upcoming = []) {
    const section = document.getElementById('myLunchSection');
    const badge = document.getElementById('myLunchBadge');
    const list = document.getElementById('myLunchList');
    if (!section || !badge || !list) return;

    // **지난 이력만** 센다. 다가오는 회차는 그리드에도 한 칸 들어오므로,
    // 여기서 같이 세면 한 번 신청한 것이 두 번 세어진다.
    const applied = rows.filter(r => r.lunch && !r.upcoming);

    // 지난 이력이 0건이어도 다가오는 신청이 있으면 '없음' 이라 하지 않는다.
    // 결과 카드의 '김밥 O' 가 보는 것이 바로 그 회차다 (getUpcomingLunches 주석).
    const total = applied.length
        ? `<span class="lunch-total-badge">🍙 총 ${applied.length}회 신청</span>`
        : (upcoming.length ? '' : `<span class="lunch-total-badge none">신청 내역 없음</span>`);

    // 한 달치를 한꺼번에 신청하는 일이 흔하다. 세 개까지 적고 나머지는 건수로.
    const SHOW = 3;
    const when = upcoming.slice(0, SHOW).map(u => u.key).join(' · ')
               + (upcoming.length > SHOW ? ` 외 ${upcoming.length - SHOW}건` : '');
    const next = upcoming.length
        ? `<span class="lunch-total-badge next">🍙 다가오는 ${escapeHtml(when)} 신청함</span>`
        : '';
    badge.innerHTML = next + total;

    // 다가오는 회차를 맨 앞에. 지금 가장 궁금한 것이라 접지 않는다.
    // 그다음은 최근 회차부터 (조회하는 사람은 대개 최근 것을 궁금해한다).
    const upChips = upcoming.map(u => `
        <span class="lunch-chip next" title="아직 지나지 않은 회차입니다">
            <b>예정</b>
            <span class="lunch-chip-date">${escapeHtml(u.key)}</span>
        </span>
    `).join('');

    list.innerHTML = upChips + [...applied].reverse().map((r, i) => `
        <span class="lunch-chip${i >= MY_LUNCH_OPEN ? ' old' : ''}">
            ${r.name ? `<b>${escapeHtml(r.name)}</b>` : ''}
            <span class="lunch-chip-date">${escapeHtml(r.key)}</span>
        </span>
    `).join('');

    setMyLunchFold(Math.max(0, applied.length - MY_LUNCH_OPEN), false);
    section.style.display = 'block';
}

/**
 * 김밥 이력 접기·펼치기. 출석 그리드·과제 목록과 같은 패턴이다
 * (setMyAttFold · setMyHwFold). 사람을 새로 조회하면 접힌 채로 시작한다.
 */
function setMyLunchFold(hidden, open) {
    const list = document.getElementById('myLunchList');
    const btn = document.getElementById('myLunchMoreBtn');
    if (!list || !btn) return;

    list.classList.toggle('folded', hidden > 0 && !open);
    btn.hidden = hidden === 0;
    btn.dataset.hidden = String(hidden);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? `↑ 최근 ${MY_LUNCH_OPEN}건만 보기` : `↓ 이전 ${hidden}건 더 보기`;
}

// 5-2. 본인 과제 제출
//
// '몇 강' 을 회차 날짜에 짝지우지 않는다. 시트가 그 대응을 말해주지 않아서
// 순서로 짐작하면 엉뚱한 회차에 붙는다. 적힌 그대로 보여준다.
async function renderMyHomework(member, attRows = []) {
    const section = document.getElementById('myHomeworkSection');
    const list = document.getElementById('myHomeworkList');
    const summary = document.getElementById('myHomeworkSummary');
    if (!section || !list) return;

    section.style.display = 'none';

    let rows = [];
    try {
        rows = await getMyHomework(member);
    } catch (err) {
        console.log('본인 과제 조회 실패:', err);
    }
    if (!shownMember || shownMember.id !== member.id) return;

    // 아직 안 낸 강의. 지나간 회차 중 '강' 이 붙은 것만 센다 —
    // 자유교제·수련회에는 낼 과제가 없다.
    //
    // **무엇을 요구하는지는 그 칸의 표기가 정한다** — homeworkRule() 한 곳에서.
    //   'full' 결석(X) → '과제+소감문' 이라야 인정된다 (공지 규칙 5)
    //   'any'  나온 주(O·돌봄) → 예습과제만 내면 끝. 종류를 안 가린다
    //   'none' 과제 · 빈칸 · − · ◎ → 묻지 않는다 ('과제' 는 시트가 이미 확인했다)
    //
    // 빈칸을 안 묻는 것이 핵심이다. 빈칸은 '합류 전' 이거나 '하차 기간' 이거나
    // '아직 저장 전' 인데 앱은 셋을 구별할 수 없고 셋 다 요구할 근거가 없다.
    // DG 는 재합류가 있어서 — 7월 합류 → 8월 하차 → 10월 재합류 — 첫 기록만
    // 보면 8~9월치가 딸려 나온다. 그 사이는 시트에서도 비어 있다.
    const missing = attRows
        // 아직 오지 않은 주는 묻지 않는다. 지금도 빈칸이라 homeworkRule 이
        // 'none' 을 주지만, 나중에 시트가 미리 표기를 넣어도 안전하도록 여기서 뺀다.
        .filter(r => !r.upcoming && isClassSession(r.name))
        .map(r => ({ r, rule: homeworkRule(r.status) }))
        .filter(({ r, rule }) =>
            rule === 'full' ? !r.homework
          : rule === 'any'  ? !(r.homework || (r.homeworkKinds || []).length)
          : false)
        .map(({ r, rule }) => ({
            name: r.name,
            // 화면이 결석분을 먼저 보여주려면 이 값이 있어야 한다. 예전에는
            // 여기서 버려서, **결석인데 아무것도 안 낸 회차**(kinds 가 빈 배열)가
            // 예습과제만 안 낸 회차와 글자 그대로 똑같이 보였다.
            rule,                                    // 'full'(결석) | 'any'(나온 주)
            // 결석한 주에만 '무엇을 냈는데 모자라다' 가 뜻이 있다.
            kinds: rule === 'full' ? (r.homeworkKinds || []) : [],
        }));

    // 출결을 못 받아 왔으면 안 낸 것이 없는 게 아니라 **모르는** 것이다.
    // 그때 '모두 냈어요' 라고 하면 거짓말이 된다.
    const known = attRows.some(r => isClassSession(r.name));
    renderHomeworkTodo(missing, known);

    // 낸 것도 없고 안 낸 것도 없으면 (회차가 아직 없다) 구역째 감춘다.
    if (!rows.length && !missing.length) return;

    if (summary) summary.textContent = rows.length ? `총 ${rows.length}건 제출` : '제출 내역 없음';

    // 최근 것부터 다섯 건만 펴 둔다. 차례는 데이터 계층이 정한다 (강 번호 내림차순).
    const folded = Math.max(0, rows.length - MY_HW_OPEN);

    // 한 줄에 하나씩. 18건이 카드로 쌓이면 화면이 통째로 밀린다.
    // 링크는 글씨 대신 🔗 로 — 다크모드에서 파란 글씨가 배경에 묻힌다.
    list.innerHTML = rows.map((r, i) => {
        const when = r.submittedAt ? String(r.submittedAt).slice(0, 10) : '';

        return `
            <div class="hw-row${i >= MY_HW_OPEN ? ' old' : ''}">
                <span class="hw-lecture">${escapeHtml(r.lecture || '(미기재)')}</span>
                <span class="hw-kind">${escapeHtml(r.kind || '')}</span>
                <span class="hw-when">${escapeHtml(when)}</span>
                <span class="hw-links${hwLinkCount(r.content) > 1 ? ' many' : ''}">${hwLinksHtml(r.content)}</span>
            </div>
        `;
    }).join('');

    setMyHwFold(folded, false);
    section.style.display = 'block';
}

/**
 * 안 낸 과제와 소감문 알림.
 *
 * 낸 것만 보여 주면 빠뜨린 사람은 빠뜨린 줄을 모른다. 지나간 회차 중
 * '몇 강' 인 것만 세고, 자유교제·수련회는 뺀다 — 낼 것이 없는 회차다.
 *
 * 다 낸 사람에게도 제출 링크는 남긴다. 다시 낼 일이 있고, 여기가 아니면
 * 링크를 찾을 곳이 없다.
 */
function renderHomeworkTodo(missing, known = true) {
    const box = document.getElementById('myHomeworkTodo');
    if (!box) return;

    const btn = `<a class="hw-todo-btn" href="${HOMEWORK_FORM_URL}" target="_blank" rel="noopener">제출하기 →</a>`;

    if (!missing.length) {
        box.className = 'hw-todo done';
        box.innerHTML = `<div class="hw-todo-head">
                <span class="hw-todo-title">${known ? '지난 회차 과제와 소감문을 모두 냈어요' : '과제와 소감문 제출'}</span>
                ${btn}
            </div>`;
        return;
    }

    // **결석분을 먼저.** 결석한 주는 '과제+소감문' 이라야 출석으로 인정되고
    // (공지 규칙 5), 나온 주는 예습과제만 내면 된다. 섞어 놓으면 급한 것과
    // 덜 급한 것이 구별되지 않고, 무엇을 내야 하는지도 출석 그리드를 되짚어야
    // 알 수 있다. 차례는 각 묶음 안에서 지금과 같다 — 회차 오름차순(밀린 것부터).
    const absent = missing.filter(m => m.rule === 'full');
    const prep = missing.filter(m => m.rule !== 'full');

    // 회차가 많으면 여덟 개만. 스무 줄짜리 목록은 아무도 안 읽는다.
    //
    // ⚠️ 묶음마다 여덟씩 두면 칩이 열여섯 개가 되어 상자가 화면을 먹는다.
    // **총 8칸을 결석분이 먼저 쓰고** 남는 자리에 예습과제분을 채운다 —
    // 그래야 급한 쪽이 안 잘린다.
    const SHOW = 8;
    const absentShown = absent.slice(0, SHOW);
    const prepShown = prep.slice(0, Math.max(0, SHOW - absentShown.length));
    const hidden = missing.length - absentShown.length - prepShown.length;

    // 아예 안 낸 회차와, 냈지만 종류가 모자란 회차를 갈라 보여준다.
    // 뒤엣것을 그냥 '안 냄' 으로 두면 '냈는데 왜' 가 되고, 빼 버리면 무엇을
    // 더 내야 하는지 알 길이 없다. (종류가 모자란 것은 결석분에만 있다)
    const chip = (m) => {
        const cls = m.rule === 'full' ? 'hw-todo-chip' : 'hw-todo-chip prep';
        if (!m.kinds.length) return `<span class="${cls}">${escapeHtml(m.name)}</span>`;
        const kinds = homeworkKindLabel(m.kinds);
        return `<span class="${cls} part" title="${escapeAttr(`낸 것: ${kinds} · 출석 인정은 과제와 소감문입니다`)}">`
             + `${escapeHtml(m.name)}<b>${escapeHtml(kinds)}</b></span>`;
    };

    // 라벨은 **두 갈래가 다 있을 때만** 붙인다. 결석이 없는 사람에게
    // '나온 회차 …' 라는 줄은 군더더기다.
    const split = absentShown.length > 0 && prepShown.length > 0;
    const group = (items, cls, label) => !items.length ? '' : `
        <div class="hw-todo-group">
            ${split ? `<span class="hw-todo-group-label ${cls}">${escapeHtml(label)}</span>` : ''}
            <div class="hw-todo-list">${items.map(chip).join('')}</div>
        </div>`;

    const rest = hidden > 0 ? `<div class="hw-todo-list"><span class="hw-todo-rest">외 ${hidden}건</span></div>` : '';

    box.className = 'hw-todo';
    box.innerHTML = `<div class="hw-todo-head">
            <span class="hw-todo-title">📝 제출하지 않은 과제와 소감문 <b>${missing.length}건</b></span>
            ${btn}
        </div>
        ${group(absentShown, 'absent', `결석한 회차 ${absent.length}건 · 과제와 소감문을 내야 출석으로 인정됩니다`)}
        ${group(prepShown, 'prep', `나온 회차 ${prep.length}건 · 예습과제만 내면 됩니다`)}
        ${rest}`;
}

/**
 * 제출 칸의 링크를 버튼으로.
 *
 * 파일을 두 개 이상 올리면 한 칸에 쉼표로 이어 붙어 온다. 통째로 href 에
 * 넣으면 첫 주소부터 열리지 않으니, 낱개로 갈라 하나씩 버튼을 준다.
 * 두 개 이상일 때만 번호를 붙인다 — 대부분은 한 개고, 그때 '🔗1' 은 군더더기다.
 */
function hwLinkCount(content) {
    return splitSubmissionLinks(content).links.length;
}

function hwLinksHtml(content) {
    const { links, text } = splitSubmissionLinks(content);

    if (!links.length) {
        return text ? `<span title="${escapeAttr(text)}">📄</span>` : '';
    }

    const many = links.length > 1;
    return links.map((url, n) => {
        const label = many ? `제출물 ${n + 1} 열기` : '제출물 열기';
        return `<a class="hw-link${many ? ' multi' : ''}" href="${escapeAttr(url)}"
                   target="_blank" rel="noopener"
                   title="${label}" aria-label="${label}">🔗${many ? `<b>${n + 1}</b>` : ''}</a>`;
    }).join('');
}

/**
 * 오래된 과제 접기·펼치기.
 *
 * 접히는 것이 목록의 **뒤쪽**(오래된 쪽)이라 버튼을 목록 아래에 둔다.
 * 출석 그리드는 앞쪽이 접혀서 버튼이 위에 있다 — 어느 쪽이든 방금 누른 버튼이
 * 제자리에 남아야 한다.
 *
 * 사람을 새로 조회할 때마다 접힌 채로 시작한다.
 */
function setMyHwFold(hidden, open) {
    const list = document.getElementById('myHomeworkList');
    const btn = document.getElementById('myHomeworkMoreBtn');
    if (!list || !btn) return;

    list.classList.toggle('folded', hidden > 0 && !open);
    btn.hidden = hidden === 0;
    btn.dataset.hidden = String(hidden);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? `↑ 최근 ${MY_HW_OPEN}건만 보기` : `↓ 이전 ${hidden}건 더 보기`;
}

// 6-2. 조 요약 — 총원 · 출석 · 결석 · 미입력 · 그 외 · 김밥
//
// **카드는 저장된 값이다.** 아래 저장 줄은 지금 체크한 값이라 둘이 다른 것이 정상이다 —
// 맨 위에 '11/01 저장된 출석' 이라고 적는 까닭이다. 안 적으면 체크 다섯 개를 해 둔
// 조장이 카드의 '출석 0' 을 보고 고장으로 읽는다. 저장하면 카드가 다시 그려진다.
//
// 빈칸은 '미입력' 으로 따로 센다. '그 외' 에 섞으면 '아직 안 찍음' 과 시트의
// 돌봄 · − · ◎ 가 한 숫자가 된다. '돌봄' 같은 표기는 출석도 결석도 아니라서 '그 외'.
// 결석으로 묶으면 조장이 "왜 결석이 이렇게 많지" 하고 잘못 읽는다.
// '과제'(과제+소감문으로 인정)는 출석에 든다 — docs/RULES.md.
//
// 칸은 여섯 개로 고정이다 (0 이어도 둔다). 수에 따라 칸이 생겼다 없어지면
// 3칸 격자에서 한 칸이 둘째 줄에 혼자 남고, 같은 자리에 다른 숫자가 온다.
function renderTeamSummary(members) {
    const el = document.getElementById('teamSummaryCard');
    if (!el) return;

    const s = getSessions().find(x => x.date === getSession());
    const label = s ? s.key : '';

    if (teamAtt.state === 'loading') {
        el.innerHTML = `<div class="summary-status" role="status">⏳ ${escapeHtml(label)} 출석 불러오는 중…</div>`;
        return;
    }
    if (teamAtt.state === 'error') {
        el.innerHTML = `<div class="summary-status error" role="alert">
            출석을 불러오지 못했습니다
            <button type="button" class="summary-retry" data-team-att-retry>다시 시도</button>
        </div>`;
        return;
    }

    const up = (v) => String(v || '').trim().toUpperCase();
    const present = members.filter(m => isPresent(m.attendance)).length;
    const absent = members.filter(m => isAbsent(m.attendance)).length;
    const blank = members.filter(m => up(m.attendance) === '').length;
    const other = members.length - present - absent - blank;
    const kimbap = members.filter(m => up(m.lunch) === 'O').length;

    const stat = (cls, value, label) => `
        <div class="stat ${cls}">
            <div class="stat-value">${value}</div>
            <div class="stat-label">${label}</div>
        </div>`;

    el.innerHTML = `<div class="summary-head">${escapeHtml(label)} 저장된 출석</div>`
        + stat('', members.length, '총원')
        + stat('present', present, '✅ 출석')
        + stat('absent', absent, '❌ 결석')
        + stat('blank', blank, '⬜ 미입력')
        + stat('special', other, '📌 그 외')
        + stat('lunch', kimbap, '🍙 김밥');
}

// 같은 조 · 같은 회차를 다시 그릴 때 **아직 저장하지 않은 체크**를 건진다.
// 배경 갱신·늦게 온 응답이 명단을 다시 그려도 조장이 해 둔 체크가 사라지면 안 된다.
function pendingChecks(listElement, teamName, session) {
    const keep = new Map();
    if (listElement.dataset.team !== teamName || listElement.dataset.session !== session) return keep;
    for (const cb of attendanceChecks()) {
        if (cb.disabled) continue;
        if ((cb.checked ? '1' : '0') !== cb.dataset.initial) keep.set(cb.dataset.id, cb.checked);
    }
    return keep;
}

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

    // 받아 오는 중이거나 못 받았으면 체크를 막는다. 모르는 값 위에 체크하게 두면
    // 응답이 왔을 때 무엇을 남겨야 할지 알 수 없다 (예전에 체크가 사라진 자리).
    const session = getSession();
    const locked = teamAtt.state !== 'ready';
    const keep = locked ? new Map() : pendingChecks(listElement, teamName, session);
    listElement.dataset.team = teamName;
    listElement.dataset.session = session;
    listElement.classList.toggle('loading', locked);
    listElement.setAttribute('aria-busy', teamAtt.state === 'loading' ? 'true' : 'false');

    // 역할(조장·부조장 등)을 맨 위로, 나머지는 **시트 순서**로.
    // 종이 출석부와 차례가 다르면 한 사람을 찾을 때마다 명단을 훑게 되고,
    // 그러다 옆줄에 체크한다 (members-data.js compareMemberOrder 주석).
    const sortedMembers = [...members].sort(compareLeadFirst);

    listElement.innerHTML = sortedMembers.map((m) => {
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        // 받아 오기 전에는 값을 그리지 않는다 — 캐시에 남은 옛 값이 맞는 줄 안다.
        const status = locked ? '' : String(m.attendance || '').trim();

        // 시트에 '돌봄' · '-' 처럼 O/X 가 아닌 표기가 있으면 체크박스를 두지 않는다.
        // 체크박스로 두면 '체크 안 됨' 으로 보여서, 조장이 무심코 눌러 그 기록을
        // O 로 덮어 버린다. 바꿔야 한다면 시트에서 직접 고치는 게 맞다.
        const isPlain = status === '' || status.toUpperCase() === 'O' || status.toUpperCase() === 'X';

        // data-initial 은 O 인가 아닌가만 담아서 빈칸과 X 를 가르지 못한다.
        // 저장할 때 GAS 가 '화면에 띄웠던 값' 과 시트를 견주므로(seen) 원값을 따로 둔다.
        const initial = status.toUpperCase() === 'O';
        const checked = keep.has(m.id) ? keep.get(m.id) : initial;
        const control = isPlain
            ? `<input type="checkbox" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}
                    class="attendance-check"
                    data-id="${escapeAttr(m.id)}"
                    data-name="${escapeAttr(m.name)}" data-phone="${escapeAttr(m.phone)}"
                    data-status="${escapeAttr(status.toUpperCase())}"
                    data-initial="${initial ? '1' : '0'}">`
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

    // 받아 오는 중 · 못 받음 · 저장 중에는 누를 수 없다. 배경 갱신이 명단을 다시
    // 그려도(setupSaveBar → 여기) 저장 중인 버튼이 다시 살아나면 안 된다.
    if (teamAttSaving) {
        btn.disabled = true;
        return;
    }
    if (teamAtt.state !== 'ready') {
        info.textContent = teamAtt.state === 'loading'
            ? '출석을 불러온 뒤 체크할 수 있습니다'
            : '출석을 불러오지 못해 저장할 수 없습니다';
        btn.disabled = true;
        btn.textContent = teamAtt.state === 'loading' ? '불러오는 중…' : '저장할 수 없음';
        bar.classList.remove('has-changes');
        return;
    }

    const checks = attendanceChecks();
    const present = checks.filter(cb => cb.checked).length;
    const changes = changedChecks().length;

    // 저장은 명단 전체를 O/X 로 쓴다. 버튼의 수도 **실제로 쓰는 수**여야 한다 —
    // '변경 1건' 이라 적고 12명을 쓰면 나중에 결석이 왜 늘었는지 알 수 없다.
    info.textContent = `출석 ${present} · 결석 ${checks.length - present}`
        + (changes ? ` · 변경 ${changes}건` : '');
    btn.disabled = changes === 0;
    btn.textContent = changes === 0 ? '변경 사항 없음' : `저장하기 (${checks.length}명)`;
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
    if (!changed.length || !btn || teamAttSaving) return;

    // 버튼이 막혀 있어야 여기 못 오지만, 받아 온 값이 없는 명단으로는 절대 쓰지 않는다 —
    // 빈 명단을 그대로 저장하면 전원이 X 로 나간다.
    if (teamAtt.state !== 'ready' || teamAtt.session !== session) return;

    if (!session) {
        alert('회차를 알 수 없어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }

    // 체크한 사람은 O, 체크 안 한 사람은 X 로 보낸다.
    //
    // 예전에는 '바뀐 사람만' 보냈다. 그러면 O 만 나가고 손대지 않은 빈칸은
    // 빈칸으로 남아, 결석자가 '기록 없음' 으로 쌓였다 — 출석도 결석도 아닌
    // 칸이라 수료를 따질 때 한 명씩 되짚어야 했다.
    //
    // 그래도 전원을 보내는 것이지 전원을 덮는 것은 아니다. ◎ · − · 돌봄 처럼
    // 사람이 시트에 직접 넣은 표기는 체크박스가 아니라 배지로 그려서 여기
    // 목록에 아예 들어오지 않는다 (위 renderTeamMembers 참고).
    //
    // seen = 화면에 띄웠던 값. DB 는 시트보다 최대 10분 뒤처져서, 그 사이 시트에 손으로
    // 넣은 O 가 여기서는 빈칸으로 보인다. GAS 가 시트의 지금 칸과 견주어 다르면 쓰지
    // 않고 changed 로 돌려준다 — 시트의 O 가 말없이 X 로 덮이던 구멍이다.
    const changes = attendanceChecks()
        .map(cb => ({
            id: cb.dataset.id,
            name: cb.dataset.name,
            phone: cb.dataset.phone,
            status: cb.checked ? 'O' : 'X',
            seen: cb.dataset.status || '',
        }));

    // **지난 회차**를 저장하려 하면 한 번 묻는다.
    //
    // 화면이 들고 있는 명단은 늘 오늘의 명단이다. 그것으로 지난 회차를 덮으면
    // 그때 명단에 없던 사람에게까지 X 가 나간다 — 이번에 처음 합류한 사람들이
    // 18·19강 결석으로 찍힌 것이 이 경로다. 막지는 않는다. 그 주에 저장을
    // 깜빡하고 다음 주에 채우는 일이 실제로 있기 때문이다.
    const willAbsent = changes.filter(c => c.status === 'X').length;
    if (willAbsent && isPastSession(session)
        && !confirm(`${session} 은 지난 회차입니다.\n\n`
                  + `지금 명단을 기준으로 체크하지 않은 ${willAbsent}명이 결석으로 저장됩니다.\n`
                  + `그때 명단에 없던 사람도 함께 저장됩니다.\n\n계속할까요?`)) {
        return;
    }

    const prevText = btn.textContent;
    teamAttSaving = true;
    btn.disabled = true;
    btn.textContent = '저장 중…';

    try {
        const { saved, kept, missing, changed: sheetFirst, dbPushed } =
            await saveAttendance(session, changes.map(({ id, ...rest }) => rest));
        teamAttSaving = false;

        // 이제 전원을 보내므로 기준선도 전원을 다시 뜬다 — **보낸 값**으로. 저장 중에
        // 배경 갱신이 명단을 다시 그렸을 수 있어 아이디로 찾는다.
        // kept·missing 은 실제로 안 바뀌었으므로 seen(data-status)은 그대로 둔다.
        // 시트가 먼저 바뀐 사람(changed)은 **시트 값으로** 다시 맞춘다.
        const sent = new Map(changes.map(c => [c.id, c.status]));
        const notWritten = new Set([...(kept || []).map(k => String(k).replace(/\(.*\)$/, '')),
                                    ...(missing || []).map(String)]);
        const sheetNow = new Map((sheetFirst || []).map(c => [c.id, String(c.current || '').toUpperCase()]));
        for (const cb of attendanceChecks()) {
            const id = cb.dataset.id;
            if (sheetNow.has(id)) {
                const cur = sheetNow.get(id);
                cb.checked = cur === 'O';
                cb.dataset.initial = cb.checked ? '1' : '0';
                cb.dataset.status = cur;
                continue;
            }
            if (!sent.has(id)) continue;
            cb.dataset.initial = sent.get(id) === 'O' ? '1' : '0';
            // 다시 저장할 때 자기가 방금 쓴 값에 걸리지 않게 seen 도 새 값으로.
            if (!notWritten.has(id)) cb.dataset.status = sent.get(id);
        }

        const notes = [];
        if (sheetFirst && sheetFirst.length) {
            notes.push(`시트에서 먼저 바뀐 ${sheetFirst.length}명은 그대로 두었습니다: `
                + sheetFirst.map(c => `${c.name}(${c.current || '빈칸'})`).join(', '));
        }
        if (kept && kept.length) notes.push(`다른 표기가 있어 두었습니다: ${kept.join(', ')}`);
        if (missing && missing.length) notes.push(`명단에 없습니다: ${missing.join(', ')}`);

        // 끝났는데 '저장 중…' 이 남아 있으면 진행 중인 줄 안다.
        btn.textContent = '✅ 저장됨';

        // 요약 숫자도 같이 맞춘다 (명단은 그대로 두고 카드만).
        if (shownMember) renderTeamSummary(getTeamMembers(shownMember.team));
        const key = getSessions().find(x => x.date === session)?.key || session;
        // DB 밀어넣기가 실패했으면 이 기기는 맞지만 다른 기기는 10분 트리거 뒤에 본다.
        if (info) info.textContent = `✅ ${key} ${saved}건 저장 완료`
            + (dbPushed === false ? ' · 시트에 저장됨 · 앱 반영은 10분 안에' : '');
        if (notes.length) alert(notes.join('\n'));

        setTimeout(refreshSaveBar, dbPushed === false ? 6000 : 2500);
    } catch (error) {
        teamAttSaving = false;
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

// extras 는 getTeamExtras(), history 는 getTeamAttendance() 결과.
//
// ⚠️ 칸 값은 **반드시 getStatus 로** 넘긴다 (CLAUDE.md 5). m.attendanceByDate 에는
// 이제 읽은 회차만 들어 있어서, 안 넘기면 한 열만 차는데 오류가 안 난다.
function renderTeamMatrix(teamName, members, extras, history) {
    const scrollEl = document.getElementById('matrixScroll');
    const titleEl = document.getElementById('matrixTitle');
    if (!scrollEl) return;

    const { titleText, tableHTML, foldBtnHtml } = renderTeamMatrixHTML(teamName, members, extras, {
        getStatus: (m, date) => history.get(m._uuid)?.get(date) ?? '',
    });

    // 버튼을 버리면 접힌 앞쪽 회차를 펼칠 길이 없다 (관리자 화면과 같게 둔다).
    if (titleEl) titleEl.innerHTML = escapeHtml(titleText) + (foldBtnHtml || '');
    scrollEl.innerHTML = tableHTML;
}

/**
 * 전체 출석표 접기 버튼 배선.
 *
 * 버튼은 머리줄(모달)에 있고 표는 스크롤 영역에 있어 형제가 아니다. 그래서
 * **모달 안에서** 표를 찾는다 — 전역으로 찾으면 표가 둘일 때 첫 것을 집는다.
 */
function wireMatrixFold(modalEl) {
    modalEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-matrix-fold]');
        if (!btn) return;
        const table = modalEl.querySelector('.matrix-table');
        if (!table) return;
        const folded = table.classList.toggle('folded');
        btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        const total = table.querySelectorAll('thead th').length - 1;
        btn.textContent = folded ? `전체 ${total}회차 보기` : '최근 10회차만';
    });
}

let matrixToken = 0;
wireMatrixFold(document.getElementById('matrixModal'));

// 받아 오는 동안 · 못 받았을 때의 모달 안.
function renderMatrixStatus(teamName, state) {
    const scrollEl = document.getElementById('matrixScroll');
    const titleEl = document.getElementById('matrixTitle');
    if (titleEl) titleEl.textContent = `👥 ${teamName} 전체 출석표`;
    if (!scrollEl) return;
    scrollEl.innerHTML = state === 'error'
        ? `<div class="matrix-status error" role="alert">출석표를 불러오지 못했습니다
               <button type="button" class="summary-retry" data-matrix-retry>다시 시도</button></div>`
        : `<div class="matrix-status" role="status">⏳ 출석표 불러오는 중…</div>`;
}

function loadMatrix() {
    if (!shownMember || !shownMember.team) return;
    const team = shownMember.team;
    const members = getTeamMembers(team);
    const modal = document.getElementById('matrixModal');

    // 칸 값(전 회차)도 DB 에서 받는다. 표를 먼저 띄우면 빈 칸이 '기록 없음' 으로 읽힌다.
    renderMatrixStatus(team, 'loading');
    const token = ++matrixToken;
    Promise.all([getTeamAttendance(members), getTeamExtras(members)])
        .then(([history, extras]) => {
            // 그새 닫혔거나 다른 조를 열었으면 늦게 온 응답은 버린다.
            if (token !== matrixToken || !modal?.classList.contains('active')) return;
            renderTeamMatrix(team, members, extras, history);
        })
        .catch(err => {
            console.log('조 출석표 조회 실패:', err);
            if (token !== matrixToken || !modal?.classList.contains('active')) return;
            renderMatrixStatus(team, 'error');
        });
}

function openMatrixModal() {
    if (!shownMember || !shownMember.team) return;

    const modal = document.getElementById('matrixModal');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    loadMatrix();
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
    // 관리자 로그인 — Supabase 가 확인한다 (scripts/admin-auth.js).
    //
    // 예전에는 여기서 아이디 · 비밀번호를 글자로 견줬다. 비밀번호가 공개 코드에 그대로
    // 있었고, 맞든 틀리든 서버는 아무것도 몰랐다. 지금은 계정도 비밀번호도 여기 없다.
    elements.adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('adminId').value;
        const pw = document.getElementById('adminPassword').value;
        const errorElement = document.getElementById('adminLoginError');
        const submitBtn = elements.adminForm.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;   // 확인 중에 한 번 더 누른 것

        const prevText = submitBtn?.textContent;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '확인 중…'; }
        try {
            await adminSignIn(id, pw);
            // 맞으면 그냥 들여보낸다. '로그인 성공!' 을 한 번 더 누르게 할 이유가 없다.
            // 알림은 틀렸을 때만 — 그때만 사람이 할 일이 남는다.
            window.location.href = 'admin.html';
            return;
        } catch (err) {
            if (errorElement) {
                errorElement.style.display = 'block';
                // AdminAuthError 의 문구는 화면에 그대로 보여도 되는 것이다
                // (틀렸다 · 권한이 없다 · 연결이 안 된다).
                errorElement.textContent = err?.name === 'AdminAuthError'
                    ? err.message
                    : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
            }
            if (err?.name !== 'AdminAuthError') console.log('관리자 로그인 실패:', err);
        }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prevText; }
    });

    // 다시 입력하기 시작하면 빨간 글씨를 지운다. 고치는 중에도 남아 있으면
    // 방금 친 것이 또 틀린 줄 안다.
    for (const id of ['adminId', 'adminPassword']) {
        document.getElementById(id)?.addEventListener('input', () => {
            const err = document.getElementById('adminLoginError');
            if (err) err.style.display = 'none';
        });
    }
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
            // 그 회차를 DB 에서 읽는다 (이 페이지에서 이미 읽었으면 바로 그린다).
            if (shownMember) showTeamAttendance();
        });
    }

    // 조원 명단 '다시 시도'
    document.getElementById('teamSummaryCard')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-team-att-retry]')) showTeamAttendance();
    });

    // 출결 일괄 저장
    const saveBtn = document.getElementById('saveAttendanceBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAttendanceChanges);

    // 지난 과제 펼치기·접기
    const hwMore = document.getElementById('myHomeworkMoreBtn');
    if (hwMore) {
        hwMore.addEventListener('click', () => {
            setMyHwFold(Number(hwMore.dataset.hidden || 0),
                        hwMore.getAttribute('aria-expanded') !== 'true');
        });
    }

    // 지난 김밥 신청 펼치기·접기
    const lunchMore = document.getElementById('myLunchMoreBtn');
    if (lunchMore) {
        lunchMore.addEventListener('click', () => {
            setMyLunchFold(Number(lunchMore.dataset.hidden || 0),
                           lunchMore.getAttribute('aria-expanded') !== 'true');
        });
    }

    // 지난 회차 펼치기·접기
    const attMore = document.getElementById('myAttendanceMoreBtn');
    if (attMore) {
        attMore.addEventListener('click', () => {
            setMyAttFold(Number(attMore.dataset.hidden || 0),
                         attMore.getAttribute('aria-expanded') !== 'true');
        });
    }

    // 전체 출석표
    const matrixBtn = document.getElementById('openMatrixBtn');
    if (matrixBtn) matrixBtn.addEventListener('click', openMatrixModal);

    const matrixClose = document.getElementById('matrixCloseBtn');
    if (matrixClose) matrixClose.addEventListener('click', closeMatrixModal);

    const matrixModal = document.getElementById('matrixModal');
    if (matrixModal) {
        matrixModal.addEventListener('click', (e) => {
            if (e.target === matrixModal) closeMatrixModal();
            if (e.target.closest('[data-matrix-retry]')) loadMatrix();
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

/**
 * 푸터에 지금 떠 있는 버전을 적는다.
 *
 * 숫자를 HTML 에 박아 두면 배포할 때마다 손으로 고쳐야 하고, 한 번 빠뜨리면
 * 새로고침해도 옛 번호가 그대로 보인다 — 정작 확인하려던 '이게 새것인가' 를
 * 못 본다. 브라우저가 실제로 받아 온 script 태그의 ?v= 를 그대로 읽는다.
 */
function showAppVersion() {
    const el = document.getElementById('appVersion');
    if (!el) return;
    const src = document.querySelector('script[src*="script.js"]')?.getAttribute('src') || '';
    const v = src.match(/[?&]v=(\d+)/);
    el.textContent = v ? `v${v[1]}` : '';
}

// 12. 실행
window.addEventListener('load', () => {
    loadData();
    initEventListeners();
    initModal();
    applyLastSearch();
    showAppVersion();
    startAutoRefresh();
});
