// 한글 초성 추출 및 매칭 유틸리티.
// 관리자 검색·필터에서 "ㄱㅁㅊ"로 "김민철" 매칭 등에 사용.

const CHO_LIST = [
    'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ',
    'ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ',
];
const HANGUL_START = 0xAC00; // '가'
const HANGUL_END   = 0xD7A3; // '힣'

/**
 * 문자열에서 각 한글 음절의 초성을 추출.
 * 한글이 아닌 문자는 원본 유지.
 * 예: "김민철7" → "ㄱㅁㅊ7"
 */
export function getInitials(str) {
    if (str == null) return '';
    let out = '';
    for (const ch of String(str)) {
        const code = ch.charCodeAt(0);
        if (code >= HANGUL_START && code <= HANGUL_END) {
            const offset = code - HANGUL_START;
            const choIdx = Math.floor(offset / 588); // 21 * 28 = 588
            out += CHO_LIST[choIdx];
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * 쿼리가 초성(자모)로만 구성되어 있는지 판별.
 * 예: "ㄱㅁㅊ" true, "김민" false
 */
export function isChoseongOnly(str) {
    if (!str) return false;
    for (const ch of str) {
        if (!CHO_LIST.includes(ch)) return false;
    }
    return true;
}

// 겹자음 → 두 초성. 한글 자판은 자음만 연달아 치면 ㄱ+ㅅ 을 'ㄳ' 한 글자로 합친다
// (PC 두벌식 · 폰 자판 다). 그대로 두면 'ㄱㅅ' 로 치려던 것이 초성 검색이 아니게 된다.
const COMPOUND = {
    'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ', 'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ', 'ㄼ': 'ㄹㅂ',
    'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ', 'ㅄ': 'ㅂㅅ',
};
function splitCompound(str) {
    return String(str).replace(/[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ]/g, (c) => COMPOUND[c]);
}

// 글자 하나를 **자판으로 친 차례**대로 푼다. '과' → 'ㄱㅗㅏ', '첤' → 'ㅊㅓㄹㅅ'.
// 치는 도중의 마지막 글자가 무엇이 될 글자인지 견주는 데 쓴다.
const JUNG_KEYS = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅗㅏ','ㅗㅐ','ㅗㅣ','ㅛ',
                   'ㅜ','ㅜㅓ','ㅜㅔ','ㅜㅣ','ㅠ','ㅡ','ㅡㅣ','ㅣ'];
const JONG_KEYS = ['','ㄱ','ㄲ','ㄱㅅ','ㄴ','ㄴㅈ','ㄴㅎ','ㄷ','ㄹ','ㄹㄱ','ㄹㅁ','ㄹㅂ','ㄹㅅ',
                   'ㄹㅌ','ㄹㅍ','ㄹㅎ','ㅁ','ㅂ','ㅂㅅ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function isSyllable(ch) {
    const code = ch.charCodeAt(0);
    return code >= HANGUL_START && code <= HANGUL_END;
}

function keystrokes(ch) {
    if (ch === undefined) return '';
    if (!isSyllable(ch)) return ch.toLowerCase();
    const offset = ch.charCodeAt(0) - HANGUL_START;
    return CHO_LIST[Math.floor(offset / 588)]
         + JUNG_KEYS[Math.floor((offset % 588) / 28)]
         + JONG_KEYS[offset % 28];
}

// 검색어 글자 하나와 대상 글자 하나. 검색어가 초성(자음 하나)이면 대상의 초성과 견준다.
function charMatches(tc, qc) {
    if (CHO_LIST.includes(qc)) return tc === qc || getInitials(tc) === qc;
    return tc.toLowerCase() === qc.toLowerCase();
}

/**
 * text가 query와 매칭되는지 판별 — 부분 문자열, 글자마다 견준다.
 *
 * - 검색어 글자가 **초성**이면 대상 글자의 초성과 견준다 ('ㄱㅁㅊ' → 김민철, 'ㄴ' → 남1)
 * - 그 밖의 글자는 그대로 (영문은 대소문자 무시)
 * - **마지막 글자는 아직 치는 중일 수 있다.** 한글 자판은 '김철수' 를 치는 동안
 *   '김ㅊ' → '김처' → '김철' → '김첤'(ㄹ+ㅅ 이 받침으로 붙었다) → '김철수' 를 차례로
 *   넣는다. 그 사이마다 '결과 없음' 이 번쩍이면 초성 검색이 안 되는 것과 같다.
 *   그래서 마지막 글자만은 **자판으로 친 차례가 대상의 앞부분과 같으면** 맞다고 본다
 *   ('흐' → 희 · '고' → 과 · '영' → 여옥 · '첤' → 철수).
 *
 * 관리자 검색칸 둘과 조회 화면 이름 찾기(findMember — 전화 뒷 4자리가 정확히
 * 맞아야 하는 뒤쪽 갈래)가 함께 쓴다.
 *
 * @param {string} text  대상 문자열 (예: 회원 이름)
 * @param {string} query 검색어
 * @returns {boolean}
 */
export function matches(text, query) {
    if (!query) return true;
    if (!text) return false;
    const t = Array.from(String(text));
    const q = Array.from(splitCompound(String(query).trim()));
    if (!q.length) return true;

    const head = q.slice(0, -1);
    const last = q[q.length - 1];

    for (let i = 0; i + q.length <= t.length; i++) {
        let ok = true;
        for (let j = 0; j < head.length && ok; j++) ok = charMatches(t[i + j], head[j]);
        if (!ok) continue;

        const pos = i + head.length;
        if (charMatches(t[pos], last)) return true;
        if (isSyllable(last)
            && (keystrokes(t[pos]) + keystrokes(t[pos + 1])).startsWith(keystrokes(last))) return true;
    }
    return false;
}
