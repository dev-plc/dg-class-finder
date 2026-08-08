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

/**
 * text가 query와 매칭되는지 판별.
 * - query가 초성만이면 text의 초성으로 부분 매칭
 * - 그렇지 않으면 text에 대해 대소문자 무시 부분 매칭
 *
 * @param {string} text  대상 문자열 (예: 회원 이름)
 * @param {string} query 검색어
 * @returns {boolean}
 */
export function matches(text, query) {
    if (!query) return true;
    if (!text) return false;
    const t = String(text);
    const q = String(query).trim();
    if (!q) return true;

    if (isChoseongOnly(q)) {
        return getInitials(t).includes(q);
    }
    return t.toLowerCase().includes(q.toLowerCase());
}
