const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const router = express.Router();

// 한글-영문 변환 라이브러리 불러오기
const krtoeng = require('./krtoeng');

// IDE 워크스페이스 경로
const IDE_WORKSPACE = path.join(__dirname, '../../storage/ide-workspace');

// 워크스페이스 디렉토리 생성
if (!fs.existsSync(IDE_WORKSPACE)) {
    fs.mkdirSync(IDE_WORKSPACE, { recursive: true });
}

// 한글 IDE 메인 페이지
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/ide/index.html'));
});

// 정적 파일 서빙 (IDE 관련)
router.use('/static', express.static(path.join(__dirname, '../../client/ide')));

// 파일 목록 조회
router.get('/files', (req, res) => {
    try {
        const files = fs.readdirSync(IDE_WORKSPACE)
            .filter(file => file.endsWith('.한글js') || file.endsWith('.js'))
            .map(file => {
                const filePath = path.join(IDE_WORKSPACE, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: stats.size,
                    modified: stats.mtime,
                    isHangul: file.endsWith('.한글js'),
                    extension: path.extname(file)
                };
            })
            .sort((a, b) => b.modified - a.modified); // 최신순 정렬
        
        res.json({ 
            success: true, 
            files,
            total: files.length,
            workspace: IDE_WORKSPACE
        });
    } catch (error) {
        console.error('파일 목록 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '파일 목록을 불러올 수 없습니다.',
            details: error.message 
        });
    }
});

// 파일 읽기
router.get('/file/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(IDE_WORKSPACE, filename);
        
        // 보안: 상위 디렉토리 접근 방지
        if (!filePath.startsWith(IDE_WORKSPACE)) {
            return res.status(403).json({ 
                success: false, 
                error: '접근이 허용되지 않는 경로입니다.' 
            });
        }
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ 
                success: false, 
                error: '파일을 찾을 수 없습니다.' 
            });
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        const stats = fs.statSync(filePath);
        
        res.json({ 
            success: true, 
            content,
            filename,
            size: stats.size,
            modified: stats.mtime,
            encoding: 'utf8'
        });
    } catch (error) {
        console.error('파일 읽기 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '파일을 읽을 수 없습니다.',
            details: error.message 
        });
    }
});

// 파일 저장
router.post('/file/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const { content } = req.body;
        
        if (content === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: '파일 내용이 필요합니다.' 
            });
        }
        
        const filePath = path.join(IDE_WORKSPACE, filename);
        
        // 보안: 상위 디렉토리 접근 방지
        if (!filePath.startsWith(IDE_WORKSPACE)) {
            return res.status(403).json({ 
                success: false, 
                error: '접근이 허용되지 않는 경로입니다.' 
            });
        }
        
        // 백업 생성 (기존 파일이 있는 경우)
        if (fs.existsSync(filePath)) {
            const backupPath = filePath + '.backup';
            fs.copyFileSync(filePath, backupPath);
        }
        
        fs.writeFileSync(filePath, content, 'utf8');
        const stats = fs.statSync(filePath);
        
        res.json({ 
            success: true, 
            message: '파일이 저장되었습니다.',
            filename,
            size: stats.size,
            modified: stats.mtime
        });
    } catch (error) {
        console.error('파일 저장 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '파일을 저장할 수 없습니다.',
            details: error.message 
        });
    }
});

// 파일 삭제
router.delete('/file/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(IDE_WORKSPACE, filename);
        
        // 보안: 상위 디렉토리 접근 방지
        if (!filePath.startsWith(IDE_WORKSPACE)) {
            return res.status(403).json({ 
                success: false, 
                error: '접근이 허용되지 않는 경로입니다.' 
            });
        }
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ 
                success: false, 
                error: '파일을 찾을 수 없습니다.' 
            });
        }
        
        // 휴지통으로 이동 (실제 삭제 대신)
        const trashDir = path.join(IDE_WORKSPACE, '.trash');
        if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir, { recursive: true });
        }
        
        const trashPath = path.join(trashDir, `${filename}.${Date.now()}`);
        fs.renameSync(filePath, trashPath);
        
        res.json({ 
            success: true, 
            message: '파일이 삭제되었습니다.',
            filename,
            trashedTo: trashPath
        });
    } catch (error) {
        console.error('파일 삭제 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '파일을 삭제할 수 없습니다.',
            details: error.message 
        });
    }
});

// 한글 → 영문 컴파일
router.post('/compile', (req, res) => {
    try {
        const { koreanCode } = req.body;
        
        if (!koreanCode) {
            return res.status(400).json({ 
                success: false, 
                error: '한글 코드가 필요합니다.' 
            });
        }
        
        const englishCode = krtoeng.compileToEnglish(koreanCode);
        
        res.json({ 
            success: true, 
            englishCode,
            originalLength: koreanCode.length,
            compiledLength: englishCode.length,
            message: '한글 → 영문 변환이 완료되었습니다.'
        });
    } catch (error) {
        console.error('컴파일 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '컴파일 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

// 영문 → 한글 디컴파일
router.post('/decompile', (req, res) => {
    try {
        const { englishCode } = req.body;
        
        if (!englishCode) {
            return res.status(400).json({ 
                success: false, 
                error: '영문 코드가 필요합니다.' 
            });
        }
        
        const koreanCode = krtoeng.decompileToKorean(englishCode);
        
        res.json({ 
            success: true, 
            koreanCode,
            originalLength: englishCode.length,
            decompiledLength: koreanCode.length,
            message: '영문 → 한글 변환이 완료되었습니다.'
        });
    } catch (error) {
        console.error('디컴파일 오류:', error);
        res.status(500).json({ 
            success: false, 
            error: '디컴파일 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

// 코드 실행
router.post('/run', (req, res) => {
    try {
        const { koreanCode, filename = 'temp_code' } = req.body;
        
        if (!koreanCode) {
            return res.status(400).json({ 
                success: false, 
                error: '실행할 코드가 필요합니다.' 
            });
        }
        
        // 한글 코드를 영문으로 컴파일
        const englishCode = krtoeng.compileToEnglish(koreanCode);
        
        // 임시 파일 생성
        const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.js`;
        const tempFilePath = path.join(IDE_WORKSPACE, tempFileName);
        fs.writeFileSync(tempFilePath, englishCode, 'utf8');
        
        // 실행 시작 시간 기록
        const startTime = Date.now();
        
        // Node.js로 실행
        const child = spawn('node', [tempFilePath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000, // 30초 타임아웃
            cwd: IDE_WORKSPACE,
            env: { ...process.env, NODE_ENV: 'development' }
        });
        
        let output = '';
        let errorOutput = '';
        let isTimeout = false;
        
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        child.on('close', (code) => {
            if (isTimeout) return; // 이미 타임아웃으로 응답함
            
            const executionTime = Date.now() - startTime;
            
            // 임시 파일 삭제
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {
                console.error('임시 파일 삭제 실패:', e.message);
            }
            
            res.json({
                success: code === 0,
                output: output.trim(),
                error: errorOutput.trim(),
                exitCode: code,
                executionTime,
                compiledCode: englishCode,
                message: code === 0 ? 
                    `코드가 성공적으로 실행되었습니다. (${executionTime}ms)` : 
                    '코드 실행 중 오류가 발생했습니다.'
            });
        });
        
        child.on('error', (error) => {
            if (isTimeout) return;
            
            // 임시 파일 삭제
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {}
            
            res.status(500).json({
                success: false,
                error: `실행 오류: ${error.message}`,
                details: error.stack
            });
        });
        
        // 타임아웃 처리
        const timeoutId = setTimeout(() => {
            isTimeout = true;
            if (!child.killed) {
                child.kill('SIGTERM');
                
                setTimeout(() => {
                    if (!child.killed) {
                        child.kill('SIGKILL');
                    }
                }, 5000);
            }
            
            try {
                fs.unlinkSync(tempFilePath);
            } catch (e) {}
            
            res.status(408).json({
                success: false,
                error: '코드 실행 시간이 초과되었습니다. (30초 제한)',
                timeout: true,
                executionTime: Date.now() - startTime
            });
        }, 30000);
        
        child.on('close', () => {
            clearTimeout(timeoutId);
        });
        
    } catch (error) {
        console.error('코드 실행 오류:', error);
        res.status(500).json({
            success: false,
            error: '코드 실행 중 서버 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 키워드 관련 API들
router.get('/keywords', (req, res) => {
    try {
        const { search } = req.query;
        
        if (search) {
            const results = krtoeng.searchKeywords(search);
            res.json({
                success: true,
                keywords: results,
                total: results.length,
                query: search
            });
        } else {
            res.json({
                success: true,
                keywords: krtoeng.koreanToEnglish,
                total: Object.keys(krtoeng.koreanToEnglish).length,
                stats: krtoeng.getStats()
            });
        }
    } catch (error) {
        console.error('키워드 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '키워드 정보를 가져올 수 없습니다.',
            details: error.message
        });
    }
});

// IDE 상태 확인
router.get('/status', (req, res) => {
    try {
        const workspaceExists = fs.existsSync(IDE_WORKSPACE);
        const files = workspaceExists ? fs.readdirSync(IDE_WORKSPACE) : [];
        const codeFiles = files.filter(f => f.endsWith('.한글js') || f.endsWith('.js'));
        const stats = krtoeng.getStats();
        
        res.json({
            success: true,
            status: 'running',
            server: {
                uptime: process.uptime(),
                nodeVersion: process.version,
                platform: process.platform,
                memory: process.memoryUsage()
            },
            workspace: {
                path: IDE_WORKSPACE,
                exists: workspaceExists,
                totalFiles: files.length,
                codeFiles: codeFiles.length
            },
            library: {
                version: stats.version,
                totalKeywords: stats.totalKeywords,
                categories: stats.categories
            }
        });
    } catch (error) {
        console.error('상태 확인 오류:', error);
        res.status(500).json({
            success: false,
            error: 'IDE 상태를 확인할 수 없습니다.',
            details: error.message
        });
    }
});

// 오류 처리 미들웨어
router.use((error, req, res, next) => {
    console.error('IDE 라우터 오류:', error);
    res.status(500).json({
        success: false,
        error: '서버 내부 오류가 발생했습니다.',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
