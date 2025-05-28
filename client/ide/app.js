// 전역 변수들
let editor;
let currentFileName = '새 파일.한글js';
let isFileModified = false;
let keywords = {};
let allKeywords = [];

// API 기본 설정
const API_BASE = '/ide';

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeIDE();
});

// IDE 초기화
async function initializeIDE() {
    try {
        showLoading('IDE 초기화 중...');
        
        // 서버 상태 확인
        await checkServerStatus();
        
        // Monaco Editor 초기화
        await initializeEditor();
        
        // 키워드 로드
        await loadKeywords();
        
        // 파일 목록 로드
        await loadFileList();
        
        // 이벤트 리스너 설정
        setupEventListeners();
        
        hideLoading();
        showToast('success', '한글 IDE가 준비되었습니다! 🎉');
        
    } catch (error) {
        console.error('IDE 초기화 실패:', error);
        hideLoading();
        showToast('error', 'IDE 초기화에 실패했습니다: ' + error.message);
    }
}

// 서버 상태 확인
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('connectionStatus').textContent = '연결됨';
            document.getElementById('serverStatus').textContent = `서버 연결됨 (${data.server.nodeVersion})`;
        } else {
            throw new Error('서버 상태 확인 실패');
        }
    } catch (error) {
        document.getElementById('connectionStatus').textContent = '연결 실패';
        document.getElementById('serverStatus').textContent = '서버 연결 실패';
        throw error;
    }
}

// Monaco Editor 초기화
async function initializeEditor() {
    return new Promise((resolve, reject) => {
        require.config({ 
            paths: { 
                'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' 
            }
        });
        
        require(['vs/editor/editor.main'], function() {
            try {
                // 한글 언어 정의
                monaco.languages.register({ id: 'hangul-js' });
                
                // 한글 키워드 토큰화
                monaco.languages.setMonarchTokensProvider('hangul-js', {
                    tokenizer: {
                        root: [
                            [/함수|변수|상수|만약|아니면|반복|동안|반환|비동기|기다리기|시도|잡기|마지막|던지기/, 'keyword'],
                            [/참|거짓|널|정의되지않음/, 'keyword.constant'],
                            [/콘솔|출력|오류|경고|정보|디버그/, 'keyword.builtin'],
                            [/불러오기|내보내기|새로운|이것|클래스|확장/, 'keyword.other'],
                            [/그리고|또는|아님|같음|다름/, 'operator'],
                            [/"([^"\\\\]|\\\\.)*"/, 'string'],
                            [/'([^'\\\\]|\\\\.)*'/, 'string'],
                            [/`([^`\\\\]|\\\\.)*`/, 'string.template'],
                            [/\/\/.*$/, 'comment'],
                            [/\/\*[\s\S]*?\*\//, 'comment'],
                            [/\d+(\.\d+)?/, 'number'],
                            [/[a-zA-Z_가-힣][a-zA-Z0-9_가-힣]*/, 'identifier']
                        ]
                    }
                });

                // 편집기 생성
                editor = monaco.editor.create(document.getElementById('editor'), {
                    value: getWelcomeCode(),
                    language: 'hangul-js',
                    theme: 'vs-dark',
                    fontSize: 14,
                    fontFamily: 'Consolas, "D2Coding", "맑은 고딕", monospace',
                    automaticLayout: true,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    lineNumbers: 'on',
                    renderWhitespace: 'selection',
                    formatOnPaste: true,
                    formatOnType: true,
                    autoClosingBrackets: 'always',
                    autoClosingQuotes: 'always',
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: {
                        other: true,
                        comments: false,
                        strings: false
                    }
                });

                // 편집기 이벤트 설정
                setupEditorEvents();
                
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

// 편집기 이벤트 설정
function setupEditorEvents() {
    // 커서 위치 변경
    editor.onDidChangeCursorPosition((e) => {
        document.getElementById('cursorPosition').textContent = 
            `줄 ${e.position.lineNumber}, 열 ${e.position.column}`;
    });

    // 내용 변경
    editor.onDidChangeModelContent(() => {
        setFileModified(true);
        
        // 자동완성 업데이트
        updateAutoCompletion();
    });

    // 키 입력 이벤트
    editor.onKeyDown((e) => {
        // Ctrl+S: 저장
        if (e.ctrlKey && e.keyCode === monaco.KeyCode.KeyS) {
            e.preventDefault();
            saveFile();
        }
        // F5: 실행
        else if (e.keyCode === monaco.KeyCode.F5) {
            e.preventDefault();
            runCode();
        }
        // F6: 컴파일
        else if (e.keyCode === monaco.KeyCode.F6) {
            e.preventDefault();
            compileCode();
        }
        // F7: 디컴파일
        else if (e.keyCode === monaco.KeyCode.F7) {
            e.preventDefault();
            decompileCode();
        }
    });
}

// 자동완성 업데이트
function updateAutoCompletion() {
    if (Object.keys(keywords).length === 0) return;
    
    monaco.languages.registerCompletionItemProvider('hangul-js', {
        provideCompletionItems: function(model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const suggestions = allKeywords.map(item => ({
                label: item.korean,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: item.korean,
                detail: `→ ${item.english}`,
                documentation: `한글 키워드 "${item.korean}"는 영문 "${item.english}"로 변환됩니다.`,
                range: range
            }));

            // 추가 제안들
            const additionalSuggestions = [
                {
                    label: '함수템플릿',
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: '함수 ${1:함수명}(${2:매개변수}) {\n\t${3:// 내용}\n}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    documentation: '함수 템플릿',
                    range: range
                },
                {
                    label: '만약문템플릿',
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: '만약 (${1:조건}) {\n\t${2:// 실행할 코드}\n}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    documentation: '조건문 템플릿',
                    range: range
                }
            ];

            return { suggestions: [...suggestions, ...additionalSuggestions] };
        }
    });
}

// 키워드 로드
async function loadKeywords() {
    try {
        const response = await fetch(`${API_BASE}/keywords`);
        const data = await response.json();
        
        if (data.success) {
            keywords = data.keywords;
            allKeywords = Object.entries(keywords).map(([korean, english]) => ({
                korean,
                english
            }));
            
            updateKeywordDisplay();
            document.getElementById('keywordCount').textContent = `${allKeywords.length}개`;
        }
    } catch (error) {
        console.error('키워드 로드 실패:', error);
        showToast('error', '키워드를 로드할 수 없습니다.');
    }
}

// 키워드 표시 업데이트
function updateKeywordDisplay() {
    const keywordList = document.getElementById('keywordList');
    keywordList.innerHTML = '';
    
    allKeywords.forEach(item => {
        const keywordItem = document.createElement('div');
        keywordItem.className = 'keyword-item';
        keywordItem.innerHTML = `
            <span class="keyword-korean">${item.korean}</span>
            <span class="keyword-english">${item.english}</span>
        `;
        keywordItem.addEventListener('click', () => {
            insertKeyword(item.korean);
        });
        keywordList.appendChild(keywordItem);
    });
}

// 키워드 필터링
function filterKeywords() {
    const query = document.getElementById('keywordSearch').value.toLowerCase();
    const keywordItems = document.querySelectorAll('.keyword-item');
    
    keywordItems.forEach(item => {
        const korean = item.querySelector('.keyword-korean').textContent.toLowerCase();
        const english = item.querySelector('.keyword-english').textContent.toLowerCase();
        
        if (korean.includes(query) || english.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// 키워드 삽입
function insertKeyword(keyword) {
    if (!editor) return;
    
    const position = editor.getPosition();
    const range = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column
    );
    
    editor.executeEdits('insert-keyword', [
        {
            range: range,
            text: keyword + ' '
        }
    ]);
    
    editor.setPosition({
        lineNumber: position.lineNumber,
        column: position.column + keyword.length + 1
    });
    
    editor.focus();
}

// 파일 목록 로드
async function loadFileList() {
    try {
        const response = await fetch(`${API_BASE}/files`);
        const data = await response.json();
        
        if (data.success) {
            updateFileList(data.files);
        }
    } catch (error) {
        console.error('파일 목록 로드 실패:', error);
        showToast('error', '파일 목록을 로드할 수 없습니다.');
    }
}

// 파일 목록 업데이트
function updateFileList(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    
    if (files.length === 0) {
        fileList.innerHTML = '<div class="empty-state"><p>저장된 파일이 없습니다.</p></div>';
        return;
    }
    
    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const icon = file.isHangul ? '📄' : '📝';
        const modifiedDate = new Date(file.modified).toLocaleString('ko-KR');
        const fileSize = formatFileSize(file.size);
        
        fileItem.innerHTML = `
            <span class="file-icon">${icon}</span>
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">
                    <span>${fileSize}</span>
                    <span>${modifiedDate}</span>
                </div>
            </div>
        `;
        
        fileItem.addEventListener('click', () => openFile(file.name));
        fileList.appendChild(fileItem);
    });
}

// 파일 크기 포맷팅
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Ctrl+N: 새 파일
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            newFile();
        }
        // Ctrl+O: 파일 열기
        else if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            showOpenDialog();
        }
        // F4: 새로고침
        else if (e.key === 'F4') {
            e.preventDefault();
            refreshFileList();
        }
        // Escape: 모달 닫기
        else if (e.key === 'Escape') {
            closeAllModals();
        }
    });
    
    // 창 크기 변경
    window.addEventListener('resize', () => {
        if (editor) {
            editor.layout();
        }
    });
    
    // 페이지 이탈 경고
    window.addEventListener('beforeunload', (e) => {
        if (isFileModified) {
            e.preventDefault();
            e.returnValue = '저장하지 않은 변경사항이 있습니다. 정말 나가시겠습니까?';
        }
    });
}

// 파일 관련 함수들
function newFile() {
    if (isFileModified) {
        if (!confirm('저장하지 않은 변경사항이 있습니다. 새 파일을 만드시겠습니까?')) {
            return;
        }
    }
    
    editor.setValue(getWelcomeCode());
    currentFileName = '새 파일.한글js';
    setFileModified(false);
    updateUI();
    showToast('info', '새 파일이 생성되었습니다.');
}

async function openFile(filename) {
    try {
        showLoading('파일을 여는 중...');
        
        const response = await fetch(`${API_BASE}/file/${encodeURIComponent(filename)}`);
        const data = await response.json();
        
        if (data.success) {
            editor.setValue(data.content);
            currentFileName = filename;
            setFileModified(false);
            updateUI();
            hideLoading();
            showToast('success', `${filename} 파일을 열었습니다.`);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        hideLoading();
        showToast('error', '파일을 열 수 없습니다: ' + error.message);
    }
}

function showOpenDialog() {
    loadFileListForModal();
    showModal('openModal');
}

async function loadFileListForModal() {
    try {
        const openFileList = document.getElementById('openFileList');
        openFileList.innerHTML = '<div class="loading">파일 목록을 불러오는 중...</div>';
        
        const response = await fetch(`${API_BASE}/files`);
        const data = await response.json();
        
        if (data.success) {
            openFileList.innerHTML = '';
            
            if (data.files.length === 0) {
                openFileList.innerHTML = '<div class="empty-state"><p>저장된 파일이 없습니다.</p></div>';
                return;
            }
            
            data.files.forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'open-file-item';
                
                const icon = file.isHangul ? '📄' : '📝';
                const modifiedDate = new Date(file.modified).toLocaleString('ko-KR');
                const fileSize = formatFileSize(file.size);
                
                fileItem.innerHTML = `
                    <span class="open-file-icon">${icon}</span>
                    <div class="open-file-info">
                        <div class="open-file-name">${file.name}</div>
                        <div class="open-file-meta">
                            <span>${fileSize}</span>
                            <span>${modifiedDate}</span>
                        </div>
                    </div>
                `;
                
                fileItem.addEventListener('click', () => {
                    closeModal('openModal');
                    openFile(file.name);
                });
                
                openFileList.appendChild(fileItem);
            });
        }
    } catch (error) {
        document.getElementById('openFileList').innerHTML = 
            '<div class="error-state"><p>파일 목록을 불러올 수 없습니다.</p></div>';
    }
}

function saveFile() {
    if (currentFileName === '새 파일.한글js') {
        showSaveDialog();
    } else {
        confirmSave(currentFileName);
    }
}

function showSaveDialog() {
    document.getElementById('saveFileName').value = currentFileName;
    showModal('saveModal');
}

async function confirmSave(filename = null) {
    try {
        const saveFileName = filename || document.getElementById('saveFileName').value.trim();
        
        if (!saveFileName) {
            showToast('warning', '파일명을 입력해주세요.');
            return;
        }
        
        // 확장자 자동 추가
        if (!saveFileName.endsWith('.한글js') && !saveFileName.endsWith('.js')) {
            saveFileName += '.한글js';
        }
        
        showLoading('파일을 저장하는 중...');
        
        const response = await fetch(`${API_BASE}/file/${encodeURIComponent(saveFileName)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: editor.getValue()
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentFileName = saveFileName;
            setFileModified(false);
            updateUI();
            hideLoading();
            closeModal('saveModal');
            refreshFileList();
            showToast('success', `${saveFileName} 파일이 저장되었습니다.`);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        hideLoading();
        showToast('error', '파일을 저장할 수 없습니다: ' + error.message);
    }
}

async function refreshFileList() {
    try {
        await loadFileList();
        showToast('info', '파일 목록이 새로고침되었습니다.');
    } catch (error) {
        showToast('error', '파일 목록을 새로고침할 수 없습니다.');
    }
}

// 코드 실행 및 변환 함수들
async function runCode() {
    try {
        const code = editor.getValue().trim();
        
        if (!code) {
            showToast('warning', '실행할 코드가 없습니다.');
            return;
        }
        
        showLoading('코드를 실행하는 중...');
        showOutput();
        showOutputTab('result');
        
        const outputContent = document.getElementById('outputContent');
        outputContent.innerHTML = '<div class="output-info">⏳ 코드 실행 중...</div>';
        
        const response = await fetch(`${API_BASE}/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                koreanCode: code,
                filename: currentFileName
            })
        });
        
        const data = await response.json();
        hideLoading();
        
        let resultHTML = '';
        
        if (data.success) {
            resultHTML += '<div class="execution-info">';
            resultHTML += '<div class="output-success">✅ 실행 완료</div>';
            resultHTML += `<div class="execution-time">실행 시간: ${data.executionTime}ms</div>`;
            resultHTML += '</div>';
            
            if (data.output) {
                resultHTML += '<div class="output-result">' + escapeHtml(data.output) + '</div>';
            }
            
            if (data.compiledCode) {
                resultHTML += '<div class="compiled-preview">';
                resultHTML += '<div class="compiled-preview-header">컴파일된 코드:</div>';
                resultHTML += '<pre>' + escapeHtml(data.compiledCode) + '</pre>';
                resultHTML += '</div>';
            }
        } else {
            resultHTML += '<div class="execution-info">';
            resultHTML += '<div class="output-error">❌ 실행 실패</div>';
            if (data.executionTime) {
                resultHTML += `<div class="execution-time">실행 시간: ${data.executionTime}ms</div>`;
            }
            resultHTML += '</div>';
            
            if (data.error) {
                resultHTML += '<div class="output-error">' + escapeHtml(data.error) + '</div>';
            }
            
            if (data.timeout) {
                resultHTML += '<div class="output-warning">⏰ 실행 시간이 초과되었습니다.</div>';
            }
        }
        
        outputContent.innerHTML = resultHTML;
        
    } catch (error) {
        hideLoading();
        showOutput();
        document.getElementById('outputContent').innerHTML = 
            '<div class="output-error">❌ 코드 실행 중 오류가 발생했습니다: ' + escapeHtml(error.message) + '</div>';
        showToast('error', '코드 실행에 실패했습니다.');
    }
}

async function compileCode() {
    try {
        const code = editor.getValue().trim();
        
        if (!code) {
            showToast('warning', '변환할 코드가 없습니다.');
            return;
        }
        
        showLoading('한글 → 영문 변환 중...');
        
        const response = await fetch(`${API_BASE}/compile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                koreanCode: code
            })
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            showOutput();
            showOutputTab('compile');
            
            const outputContent = document.getElementById('outputContent');
            outputContent.innerHTML = `
                <div class="execution-info">
                    <div class="output-success">✅ 한글 → 영문 변환 완료</div>
                    <div>원본 길이: ${data.originalLength}자 → 변환 길이: ${data.compiledLength}자</div>
                </div>
                <div class="compiled-preview">
                    <div class="compiled-preview-header">변환된 영문 코드:</div>
                    <pre>${escapeHtml(data.englishCode)}</pre>
                </div>
            `;
            
            showToast('success', '한글 → 영문 변환이 완료되었습니다.');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        hideLoading();
        showToast('error', '변환에 실패했습니다: ' + error.message);
    }
}

async function decompileCode() {
    try {
        const code = editor.getValue().trim();
        
        if (!code) {
            showToast('warning', '변환할 코드가 없습니다.');
            return;
        }
        
        showLoading('영문 → 한글 변환 중...');
        
        const response = await fetch(`${API_BASE}/decompile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                englishCode: code
            })
        });
        
        const data = await response.json();
        hideLoading();
        
        if (data.success) {
            showOutput();
            showOutputTab('compile');
            
            const outputContent = document.getElementById('outputContent');
            outputContent.innerHTML = `
                <div class="execution-info">
                    <div class="output-success">✅ 영문 → 한글 변환 완료</div>
                    <div>원본 길이: ${data.originalLength}자 → 변환 길이: ${data.decompiledLength}자</div>
                </div>
                <div class="compiled-preview">
                    <div class="compiled-preview-header">변환된 한글 코드:</div>
                    <pre>${escapeHtml(data.koreanCode)}</pre>
                </div>
            `;
            
            // 변환된 코드를 편집기에 적용할지 묻기
            if (confirm('변환된 한글 코드를 편집기에 적용하시겠습니까?')) {
                editor.setValue(data.koreanCode);
                setFileModified(true);
            }
            
            showToast('success', '영문 → 한글 변환이 완료되었습니다.');
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        hideLoading();
        showToast('error', '변환에 실패했습니다: ' + error.message);
    }
}

// UI 관련 함수들
function setFileModified(modified) {
    isFileModified = modified;
    const fileStatus = document.getElementById('fileStatus');
    
    if (modified) {
        fileStatus.textContent = '●';
        fileStatus.className = 'file-status';
    } else {
        fileStatus.textContent = '●';
        fileStatus.className = 'file-status saved';
    }
}

function updateUI() {
    document.getElementById('currentFileName').textContent = currentFileName;
    document.querySelector('.tab-name').textContent = currentFileName;
    document.title = `${currentFileName} - 한글 IDE`;
}

function showOutput() {
    const outputPanel = document.getElementById('outputPanel');
    outputPanel.classList.add('show');
}

function toggleOutput() {
    const outputPanel = document.getElementById('outputPanel');
    outputPanel.classList.toggle('show');
}

function clearOutput() {
    document.getElementById('outputContent').innerHTML = '';
}

function showOutputTab(tabName) {
    const tabs = document.querySelectorAll('.output-tab');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        }
    });
}

function closeTab() {
    if (isFileModified) {
        if (!confirm('저장하지 않은 변경사항이 있습니다. 탭을 닫으시겠습니까?')) {
            return;
        }
    }
    newFile();
}

// 모달 관련 함수들
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('show');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show');
}

function closeAllModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => modal.classList.remove('show'));
}

function showHelp() {
    showModal('helpModal');
}

// 로딩 관련 함수들
function showLoading(message = '처리 중...') {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    loadingText.textContent = message;
    loadingOverlay.classList.add('show');
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.classList.remove('show');
}

// 토스트 알림 함수
function showToast(type, message) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');
    
    // 아이콘 설정
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toastIcon.textContent = icons[type] || icons.info;
    toastMessage.textContent = message;
    
    // 클래스 초기화
    toast.className = 'toast';
    toast.classList.add(type, 'show');
    
    // 3초 후 자동 숨김
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 유틸리티 함수들
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getWelcomeCode() {
    return `// 🇰🇷 한글 Node.js 웹 IDE에 오신 것을 환영합니다!
// 브라우저에서 한글로 코딩하고 서버에서 실행할 수 있습니다.

함수 환영인사() {
    콘솔.출력("안녕하세요! 한글 웹 IDE입니다! 🎉");
    변수 사용자이름 = "개발자";
    콘솔.출력(\`환영합니다, \${사용자이름}님!\`);
}

비동기 함수 예제코드() {
    시도 {
        콘솔.출력("=== 한글 키워드 예제 ===");
        
        // 변수 선언
        변수 숫자들 = [1, 2, 3, 4, 5];
        상수 메시지 = "한글로 코딩하기";
        
        // 반복문
        반복 (변수 i = 0; i < 숫자들.length; i++) {
            만약 (숫자들[i] % 2 === 0) {
                콘솔.출력(\`\${숫자들[i]}는 짝수입니다.\`);
            } 아니면 {
                콘솔.출력(\`\${숫자들[i]}는 홀수입니다.\`);
            }
        }
        
        콘솔.출력(메시지 + " - 완료!");
        
    } 잡기 (오류) {
        콘솔.오류("오류 발생:", 오류);
    }
}

// 함수 실행
환영인사();
예제코드();

콘솔.출력("\\n🚀 F5를 눌러서 코드를 실행해보세요!");
콘솔.출력("🔄 F6을 눌러서 영문으로 변환해보세요!");`;
}

// 모달 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeAllModals();
    }
});

// 파일 선택 함수
function selectFile(element, filename) {
    // 기존 활성 상태 제거
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // 현재 항목 활성화
    element.classList.add('active');
    
    // 파일 열기
    if (filename !== currentFileName) {
        openFile(filename);
    }
}
