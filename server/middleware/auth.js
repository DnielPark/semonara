require('dotenv').config({ path: '../config/.env' });
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const database = require('../database/connection');
const User = require('../database/models/User');

// ================================================================
// TokenManager 연동 (기기별 토큰 관리)
// ================================================================
const tokenManager = require('../services/TokenManager');
const connectionTracker = require('./connectionTracker');

// 환경변수 설정
const JWT_SECRET = process.env.JWT_SECRET || 'semonara-secret-2025';
const GMAIL_USER = process.env.EMAIL_USER;
const GMAIL_PASS = process.env.EMAIL_APP_PASSWORD;
const AUTHORIZED_EMAIL = process.env.EMAIL_TO;

// Gmail 설정
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS
    }
});

/**
 * 6자리 인증 코드 생성
 */
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 단순 이메일 발송
 */
async function sendEmailCode(email, code) {
    const mailOptions = {
        from: GMAIL_USER,
        to: email,
        subject: 'Semonara 인증 코드',
        html: `
            <h2>Semonara 인증 코드</h2>
            <p>인증 코드: <strong style="font-size: 24px; color: #007bff;">${code}</strong></p>
            <p>유효시간: 5분</p>
            <p style="color: #666;">본인이 요청하지 않았다면 이 이메일을 무시하세요.</p>
        `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[AUTH] 인증 코드 발송: ${email}`);
}

/**
 * 클라이언트 IP 주소 추출
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip || 
           'unknown';
}

/**
 * 인증 코드 요청 API
 */
async function requestEmailCode(req, res) {
    try {
        const { email } = req.body;

        if (!email || email !== AUTHORIZED_EMAIL) {
            return res.status(403).json({
                success: false,
                message: '허가되지 않은 이메일입니다.'
            });
        }

        // 사용자 차단 상태 확인
        const isBlocked = await User.isBlocked(email);
        if (isBlocked) {
            return res.status(429).json({
                success: false,
                message: '일시적으로 차단되었습니다. 잠시 후 다시 시도해주세요.'
            });
        }

        // 새 코드 생성
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료

        // 데이터베이스에 저장
        await User.createOrUpdate(email, code, expiresAt.toISOString());

        // 이메일 발송
        await sendEmailCode(email, code);

        res.json({
            success: true,
            message: '인증 코드가 전송되었습니다.'
        });

    } catch (error) {
        console.error('[AUTH] 코드 발송 실패:', error);
        res.status(500).json({
            success: false,
            message: '코드 발송에 실패했습니다.'
        });
    }
}

/**
 * 인증 코드 검증 API - 기기별 토큰 관리 버전
 */
async function verifyEmailCode(req, res) {
    try {
        const { email, code } = req.body;

        if (!email || email !== AUTHORIZED_EMAIL) {
            return res.status(403).json({
                success: false,
                message: '허가되지 않은 이메일입니다.'
            });
        }

        // 현재 사용자 정보 조회
        const userInfo = await User.findByEmail(email);
        
        // 시도 횟수 확인 (5회 제한)
        if (userInfo && userInfo.login_attempts >= 5) {
            const blockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            await User.blockUser(email, blockUntil);
            return res.status(429).json({
                success: false,
                message: '시도 횟수 초과. 새 코드를 요청하세요.'
            });
        }

        // 코드 검증
        const user = await User.verifyCode(email, code);
        
        if (!user) {
            // 로그인 시도 횟수 증가
            await User.incrementLoginAttempts(email);
            
            const remainingAttempts = 5 - (userInfo ? userInfo.login_attempts + 1 : 1);
            return res.status(400).json({
                success: false,
                message: `잘못된 코드입니다. (${remainingAttempts}회 남음)`
            });
        }

        // ================================================================
        // 기기별 TokenManager를 통한 토큰 발급
        // ================================================================
        
        // 기기별 토큰 발급 (req 객체 전달하여 기기 식별)
        const tokenResult = tokenManager.issueTokenWithDeviceInfo(email, user.id.toString(), req);
        
        // 데이터베이스 업데이트
        await User.updateLastLogin(email);

        res.json({
            success: true,
            message: '인증 완료',
            token: tokenResult.token,
            deviceInfo: tokenResult.deviceInfo,
            tokenInfo: {
                expiresIn: tokenResult.expiresIn,
                expiresAt: tokenResult.expiresAt,
                gracePeriod: tokenManager.GRACE_PERIOD / 1000,
                maxConcurrentDevices: tokenManager.MAX_CONCURRENT_DEVICES
            }
        });

        console.log(`[AUTH] 기기별 로그인 성공: ${email} - ${tokenResult.deviceInfo.device}/${tokenResult.deviceInfo.os} (${tokenResult.deviceInfo.fingerprint})`);

    } catch (error) {
        console.error('[AUTH] 인증 실패:', error);
        res.status(500).json({
            success: false,
            message: '인증 처리 실패'
        });
    }
}

/**
 * 토큰 인증 미들웨어 - 기기별 토큰 검증
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            message: '토큰이 필요합니다.'
        });
    }

    // ================================================================
    // 기기별 TokenManager를 통한 토큰 검증
    // ================================================================
    const tokenData = tokenManager.verifyToken(token);
    if (!tokenData) {
        return res.status(403).json({
            success: false,
            message: '유효하지 않은 토큰입니다.'
        });
    }

    if (tokenData.email !== AUTHORIZED_EMAIL) {
        return res.status(403).json({
            success: false,
            message: '접근 권한이 없습니다.'
        });
    }

    // 요청 객체에 사용자 정보 추가
    req.user = tokenData;
    req.clientIP = getClientIP(req);
    req.deviceFingerprint = tokenData.deviceFingerprint;
    
    // ConnectionTracker에 활동 기록
    connectionTracker.updateConnection(
        req.clientIP, 
        tokenData.userId, 
        req.get('User-Agent'), 
        Date.now()
    );

    next();
}

/**
 * 인증 상태 확인 API - 기기별 정보 포함
 */
function checkAuthStatus(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.json({ authenticated: false });
    }

    // 기기별 TokenManager를 통한 토큰 검증
    const tokenData = tokenManager.verifyToken(token);
    if (!tokenData) {
        return res.json({ authenticated: false });
    }

    // 사용자의 모든 활성 기기 목록 조회
    const activeDevices = tokenManager.getUserActiveDevices(tokenData.userId);

    res.json({
        authenticated: true,
        email: tokenData.email,
        userId: tokenData.userId,
        currentDevice: {
            fingerprint: tokenData.deviceFingerprint,
            info: tokenData.deviceInfo,
            ip: tokenData.ip,
            lastActivity: tokenData.lastActivity,
            expiresAt: tokenData.expiresAt
        },
        allDevices: activeDevices,
        remainingTime: Math.max(0, tokenData.expiresAt - Date.now()),
        tokenInfo: {
            expiresIn: tokenManager.TOKEN_EXPIRES_IN,
            gracePeriod: tokenManager.GRACE_PERIOD / 1000,
            activityThreshold: tokenManager.ACTIVITY_THRESHOLD / 1000,
            maxConcurrentDevices: tokenManager.MAX_CONCURRENT_DEVICES
        }
    });
}

/**
 * 로그아웃 API - 기기별 로그아웃
 */
function logout(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const { logoutAll = false } = req.body; // 모든 기기에서 로그아웃 옵션

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const userId = decoded.userId;
            
            if (logoutAll) {
                // 모든 기기에서 로그아웃
                tokenManager.revokeUserTokens(userId);
                console.log(`[AUTH] 전체 기기 로그아웃: ${decoded.email}`);
            } else {
                // 현재 기기에서만 로그아웃
                tokenManager.revokeToken(token, '사용자 로그아웃');
                console.log(`[AUTH] 단일 기기 로그아웃: ${decoded.email} - ${decoded.deviceFingerprint}`);
            }
        } catch (error) {
            console.error('[AUTH] 로그아웃 처리 오류:', error);
        }
    }

    res.json({
        success: true,
        message: logoutAll ? '모든 기기에서 로그아웃되었습니다.' : '현재 기기에서 로그아웃되었습니다.'
    });
}

// ================================================================
// 새로운 기기별 세션 관리 API
// ================================================================

/**
 * 세션 연장 API
 */
function extendSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: '토큰이 필요합니다.'
        });
    }

    try {
        // TokenManager를 통한 토큰 연장
        const newToken = tokenManager.extendToken(token);
        
        if (!newToken) {
            return res.status(403).json({
                success: false,
                message: '토큰 연장에 실패했습니다.'
            });
        }

        res.json({
            success: true,
            message: '세션이 성공적으로 연장되었습니다.',
            token: newToken,
            tokenInfo: {
                expiresIn: tokenManager.TOKEN_EXPIRES_IN,
                gracePeriod: tokenManager.GRACE_PERIOD / 1000
            }
        });

        console.log(`[AUTH] 세션 연장 성공`);

    } catch (error) {
        console.error('[AUTH] 세션 연장 실패:', error);
        res.status(500).json({
            success: false,
            message: '세션 연장 처리 실패'
        });
    }
}

/**
 * 하트비트 API (ConnectionTracker 위임)
 */
function handleHeartbeat(req, res) {
    connectionTracker.handleHeartbeat(req, res);
}

/**
 * SSE 세션 이벤트 스트림 - 기기별
 */
function sessionEventStream(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: '토큰이 필요합니다.'
        });
    }

    const tokenData = tokenManager.verifyToken(token);
    if (!tokenData) {
        return res.status(403).json({
            success: false,
            message: '유효하지 않은 토큰입니다.'
        });
    }

    // SSE 헤더 설정
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // TokenManager에 기기별 SSE 연결 등록
    tokenManager.registerSSEConnection(token, res);

    // 초기 연결 확인 메시지
    res.write(`data: ${JSON.stringify({
        type: 'connected',
        message: `${tokenData.deviceInfo.device} 기기의 SSE 연결이 설정되었습니다.`,
        deviceInfo: tokenData.deviceInfo,
        timestamp: Date.now()
    })}\n\n`);

    console.log(`[AUTH] 기기별 SSE 연결: ${tokenData.email} - ${tokenData.deviceFingerprint}`);
}

/**
 * 사용자 활성 기기 목록 조회
 */
function getUserDevices(req, res) {
    try {
        const userId = req.user.userId;
        const activeDevices = tokenManager.getUserActiveDevices(userId);
        
        res.json({
            success: true,
            devices: activeDevices,
            currentDevice: req.user.deviceFingerprint,
            maxDevices: tokenManager.MAX_CONCURRENT_DEVICES,
            totalDevices: activeDevices.length
        });
    } catch (error) {
        console.error('[AUTH] 기기 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '기기 목록 조회 실패'
        });
    }
}

/**
 * 특정 기기 강제 로그아웃
 */
function logoutDevice(req, res) {
    try {
        const { deviceFingerprint } = req.params;
        const userId = req.user.userId;
        
        // 해당 기기가 현재 사용자의 기기인지 확인
        const userDevices = tokenManager.getUserActiveDevices(userId);
        const targetDevice = userDevices.find(device => device.deviceFingerprint === deviceFingerprint);
        
        if (!targetDevice) {
            return res.status(404).json({
                success: false,
                message: '해당 기기를 찾을 수 없습니다.'
            });
        }
        
        // 자신의 현재 기기인지 확인
        if (deviceFingerprint === req.user.deviceFingerprint) {
            return res.status(400).json({
                success: false,
                message: '현재 사용 중인 기기는 강제 로그아웃할 수 없습니다.'
            });
        }
        
        // 기기 강제 로그아웃
        tokenManager.revokeDeviceToken(deviceFingerprint, '다른 기기에서 강제 로그아웃');
        
        res.json({
            success: true,
            message: `${targetDevice.deviceInfo.device} 기기에서 로그아웃되었습니다.`,
            loggedOutDevice: targetDevice.deviceInfo
        });
        
        console.log(`[AUTH] 기기 강제 로그아웃: ${req.user.email} - ${deviceFingerprint}`);
        
    } catch (error) {
        console.error('[AUTH] 기기 로그아웃 실패:', error);
        res.status(500).json({
            success: false,
            message: '기기 로그아웃 처리 실패'
        });
    }
}

/**
 * 토큰 및 기기 통계 조회 API (관리자용)
 */
function getTokenStats(req, res) {
    try {
        const tokenStats = tokenManager.getStats();
        const connectionStats = connectionTracker.getConnectionStats();

        res.json({
            success: true,
            timestamp: Date.now(),
            tokenManager: tokenStats,
            connectionTracker: connectionStats
        });
    } catch (error) {
        console.error('[AUTH] 통계 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '통계 조회 실패'
        });
    }
}

module.exports = {
    requestEmailCode,
    verifyEmailCode,
    authenticateToken,
    checkAuthStatus,
    logout,
    extendSession,        // 세션 연장
    handleHeartbeat,      // 하트비트
    sessionEventStream,   // SSE 이벤트 스트림
    getUserDevices,       // 사용자 기기 목록 조회 (새로 추가)
    logoutDevice,         // 특정 기기 로그아웃 (새로 추가)
    getTokenStats         // 통계 조회
};
