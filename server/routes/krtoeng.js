/**
 * 한글-영문 키워드 매핑 라이브러리
 * Korean to English Keyword Mapping Library
 * 
 * @version 1.0.0
 * @author Semonara Team
 * @description Node.js 한글 프로그래밍을 위한 키워드 변환 라이브러리
 */

// 기본 한글-영문 키워드 매핑
const koreanToEnglish = {
    // 기본 키워드
    '함수': 'function',
    '변수': 'let',
    '상수': 'const',
    '만약': 'if',
    '아니면': 'else',
    '아니면만약': 'else if',
    '반복': 'for',
    '동안': 'while',
    '반환': 'return',
    '멈춤': 'break',
    '계속': 'continue',
    '전환': 'switch',
    '경우': 'case',
    '기본값': 'default',
    
    // 데이터 타입
    '참': 'true',
    '거짓': 'false',
    '널': 'null',
    '정의되지않음': 'undefined',
    '문자열': 'string',
    '숫자': 'number',
    '불린': 'boolean',
    '객체': 'object',
    '배열': 'array',
    
    // 콘솔 관련
    '콘솔': 'console',
    '출력': 'log',
    '오류': 'error',
    '경고': 'warn',
    '정보': 'info',
    '디버그': 'debug',
    '표': 'table',
    '시간': 'time',
    '시간끝': 'timeEnd',
    '지우기': 'clear',
    
    // 모듈 관련
    '불러오기': 'require',
    '내보내기': 'module.exports',
    '가져오기': 'import',
    '보내기': 'export',
    '기본내보내기': 'export default',
    
    // 객체 지향
    '새로운': 'new',
    '이것': 'this',
    '클래스': 'class',
    '확장': 'extends',
    '생성자': 'constructor',
    '정적': 'static',
    '상속': 'super',
    
    // 예외 처리
    '시도': 'try',
    '잡기': 'catch',
    '마지막': 'finally',
    '던지기': 'throw',
    
    // 비동기 관련
    '비동기': 'async',
    '기다리기': 'await',
    '약속': 'Promise',
    '해결': 'resolve',
    '거부': 'reject',
    '그때': 'then',
    '실패시': 'catch',
    
    // 타입 검사
    '타입': 'typeof',
    '인스턴스': 'instanceof',
    
    // 연산자 (한글로 표현 가능한 것들)
    '그리고': '&&',
    '또는': '||',
    '아님': '!',
    '같음': '===',
    '다름': '!==',
    '크거나같음': '>=',
    '작거나같음': '<=',
    
    // Node.js 전용
    '프로세스': 'process',
    '환경변수': 'process.env',
    '종료': 'process.exit',
    '경로': 'path',
    '파일시스템': 'fs',
    '서버': 'server',
    '요청': 'request',
    '응답': 'response',
    '미들웨어': 'middleware',
    
    // Express 관련
    '익스프레스': 'express',
    '라우터': 'router',
    '가져오기요청': 'get',
    '보내기요청': 'post',
    '수정요청': 'put',
    '삭제요청': 'delete',
    '듣기': 'listen',
    '사용': 'use',
    
    // HTTP 관련
    '상태코드': 'status',
    '제이슨': 'json',
    '보내기': 'send',
    '리다이렉트': 'redirect',
    '쿠키': 'cookie',
    '세션': 'session',
    '헤더': 'headers',
    
    // 데이터베이스 관련 (일반적)
    '데이터베이스': 'database',
    '연결': 'connect',
    '쿼리': 'query',
    '검색': 'find',
    '저장': 'save',
    '업데이트': 'update',
    '삭제': 'delete',
    '생성': 'create',
    '스키마': 'schema',
    '모델': 'model'
};

// 영문-한글 매핑 (역변환용)
const englishToKorean = {};
for (const [korean, english] of Object.entries(koreanToEnglish)) {
    // 중복 방지: 첫 번째 매핑만 저장
    if (!englishToKorean[english]) {
        englishToKorean[english] = korean;
    }
}

/**
 * 한글 코드를 영문으로 컴파일
 * @param {string} koreanCode - 한글 코드
 * @return {string} - 영문으로 변환된 코드
 */
function compileToEnglish(koreanCode) {
    if (!koreanCode || typeof koreanCode !== 'string') {
        return '';
    }
    
    let englishCode = koreanCode;
    
    // 정확한 단어 경계를 사용한 변환
    for (const [korean, english] of Object.entries(koreanToEnglish)) {
        // 한글 키워드를 정규식으로 찾아서 변환
        const regex = new RegExp(`\\b${escapeRegExp(korean)}\\b`, 'g');
        englishCode = englishCode.replace(regex, english);
    }
    
    return englishCode;
}

/**
 * 영문 코드를 한글로 디컴파일
 * @param {string} englishCode - 영문 코드
 * @return {string} - 한글로 변환된 코드
 */
function decompileToKorean(englishCode) {
    if (!englishCode || typeof englishCode !== 'string') {
        return '';
    }
    
    let koreanCode = englishCode;
    
    // 긴 키워드부터 처리 (else if 등)
    const sortedEntries = Object.entries(englishToKorean)
        .sort(([a], [b]) => b.length - a.length);
    
    for (const [english, korean] of sortedEntries) {
        const regex = new RegExp(`\\b${escapeRegExp(english)}\\b`, 'g');
        koreanCode = koreanCode.replace(regex, korean);
    }
    
    return koreanCode;
}

/**
 * 정규식에서 특수문자 이스케이프
 * @param {string} string - 이스케이프할 문자열
 * @return {string} - 이스케이프된 문자열
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 키워드 검색
 * @param {string} query - 검색어
 * @return {Array} - 매칭되는 키워드 배열
 */
function searchKeywords(query) {
    if (!query) return [];
    
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    for (const [korean, english] of Object.entries(koreanToEnglish)) {
        if (korean.includes(lowerQuery) || english.toLowerCase().includes(lowerQuery)) {
            results.push({ korean, english });
        }
    }
    
    return results.sort((a, b) => a.korean.localeCompare(b.korean));
}

/**
 * 새로운 키워드 매핑 추가
 * @param {string} korean - 한글 키워드
 * @param {string} english - 영문 키워드
 */
function addKeywordMapping(korean, english) {
    if (korean && english) {
        koreanToEnglish[korean] = english;
        if (!englishToKorean[english]) {
            englishToKorean[english] = korean;
        }
    }
}

/**
 * 키워드 매핑 제거
 * @param {string} korean - 제거할 한글 키워드
 */
function removeKeywordMapping(korean) {
    if (koreanToEnglish[korean]) {
        const english = koreanToEnglish[korean];
        delete koreanToEnglish[korean];
        if (englishToKorean[english] === korean) {
            delete englishToKorean[english];
        }
    }
}

/**
 * 통계 정보 반환
 * @return {Object} - 키워드 통계
 */
function getStats() {
    return {
        totalKeywords: Object.keys(koreanToEnglish).length,
        categories: {
            basic: ['함수', '변수', '상수', '만약', '아니면', '반복', '동안', '반환'].length,
            dataTypes: ['참', '거짓', '널', '정의되지않음', '문자열', '숫자', '불린'].length,
            console: ['콘솔', '출력', '오류', '경고', '정보'].length,
            async: ['비동기', '기다리기', '약속', '해결', '거부'].length,
            nodejs: ['프로세스', '경로', '파일시스템', '서버'].length
        },
        version: '1.0.0'
    };
}

// 모듈 내보내기
module.exports = {
    koreanToEnglish,
    englishToKorean,
    compileToEnglish,
    decompileToKorean,
    searchKeywords,
    addKeywordMapping,
    removeKeywordMapping,
    getStats
};
