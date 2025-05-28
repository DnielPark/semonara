// ================================================================
// 인증 API 라우트 파일 - 기기별 토큰 관리 버전
// 경로: /home/ubuntu/semonara/server/routes/api/auth.js
// 설명: 이메일 인증, 기기별 JWT 토큰 관리, 실시간 세션 관리 라우트
// ================================================================

const express = require('express');
const router = express.Router();
const authController = require('../../middleware/auth');

// ================================================================
// 기본 인증 관련 API 라우트
// ================================================================

/**
 * POST /api/auth/request-code
 * 이메일 인증 코드 요청
 */
router.post('/request-code', authController.requestEmailCode);

/**
 * POST /api/auth/verify-code  
 * 인증 코드 검증 및 기기별 로그인
 * 
 * Request Headers:
 *   X-Device-Fingerprint: 클라이언트 기기 핑거프린트
 *   X-Session-Id: 브라우저 세션 ID
 * 
 * Response:
 *   - token: JWT 토큰
 *   - deviceInfo: 기기 정보 (fingerprint, device, os, browser, ip)
 *   - tokenInfo: 토큰 설정 정보
 */
router.post('/verify-code', authController.verifyEmailCode);

/**
 * GET /api/auth/status
 * 현재 인증 상태 확인 (기기별 정보 포함)
 * 
 * Response:
 *   - currentDevice: 현재 기기 정보
 *   - allDevices: 사용자의 모든 활성 기기 목록
 */
router.get('/status', authController.checkAuthStatus);

/**
 * POST /api/auth/logout
 * 로그아웃 (기기별 또는 전체)
 * 
 * Request Body:
 *   - logoutAll: boolean (선택적, true시 모든 기기에서 로그아웃)
 */
router.post('/logout', authController.authenticateToken, authController.logout);

/**
 * GET /api/auth/profile
 * 사용자 프로필 정보 (기기 정보 포함)
 */
router.get('/profile', authController.authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            email: req.user.email,
            userId: req.user.userId,
            loginTime: new Date(req.user.iat * 1000).toISOString(),
            expiresAt: new Date(req.user.exp * 1000).toISOString()
        },
        device: {
            fingerprint: req.user.deviceFingerprint,
            info: req.user.deviceInfo,
            ip: req.user.ip,
            lastActivity: req.user.lastActivity
        }
    });
});

// ================================================================
// 기기별 세션 관리 API 라우트
// ================================================================

/**
 * POST /api/auth/extend
 * 세션 연장 (새 토큰 발급)
 */
router.post('/extend', authController.extendSession);

/**
 * GET /api/auth/heartbeat
 * 하트비트 (활동 상태 확인 및 업데이트)
 */
router.get('/heartbeat', authController.handleHeartbeat);

/**
 * GET /api/auth/session-events
 * SSE 실시간 세션 이벤트 스트림 (기기별)
 */
router.get('/session-events', authController.sessionEventStream);

/**
 * GET /api/auth/devices
 * 사용자의 활성 기기 목록 조회
 * 
 * Response:
 *   - devices: 활성 기기 목록
 *   - currentDevice: 현재 기기 핑거프린트
 *   - maxDevices: 최대 동시 접속 가능 기기 수
 */
router.get('/devices', authController.authenticateToken, authController.getUserDevices);

/**
 * DELETE /api/auth/devices/:deviceFingerprint
 * 특정 기기 강제 로그아웃
 * 
 * Parameters:
 *   - deviceFingerprint: 로그아웃할 기기의 핑거프린트
 */
router.delete('/devices/:deviceFingerprint', authController.authenticateToken, authController.logoutDevice);

/**
 * GET /api/auth/stats
 * 토큰 및 연결 통계 조회 (관리자용)
 */
router.get('/stats', authController.authenticateToken, authController.getTokenStats);

// ================================================================
// 테스트 및 개발 전용 엔드포인트
// ================================================================

if (process.env.NODE_ENV === 'development') {
    /**
     * GET /api/auth/test-expiry
     * 토큰 만료 테스트 (개발 모드에서만 사용)
     */
    router.get('/test-expiry', authController.authenticateToken, (req, res) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            const tokenManager = require('../../services/TokenManager');
            setTimeout(() => {
                tokenManager.revokeToken(token, '테스트: 강제 만료');
            }, 1000);
            
            res.json({
                success: true,
                message: '1초 후 현재 기기의 토큰이 만료됩니다. (테스트용)',
                deviceFingerprint: req.user.deviceFingerprint,
                timestamp: Date.now()
            });
        } else {
            res.status(400).json({
                success: false,
                message: '토큰이 필요합니다.'
            });
        }
    });

    /**
     * GET /api/auth/test-device-limit
     * 기기 제한 테스트 (개발 모드에서만)
     */
    router.get('/test-device-limit', authController.authenticateToken, (req, res) => {
        const tokenManager = require('../../services/TokenManager');
        const userId = req.user.userId;
        const activeDevices = tokenManager.getUserActiveDevices(userId);
        
        res.json({
            success: true,
            message: '현재 사용자의 기기 접속 현황',
            userId,
            currentDevice: req.user.deviceFingerprint,
            activeDevices: activeDevices.map(device => ({
                fingerprint: device.deviceFingerprint,
                device: device.deviceInfo.device,
                os: device.deviceInfo.os,
                browser: device.deviceInfo.browser,
                ip: device.ip,
                lastActivity: new Date(device.lastActivity).toLocaleString(),
                issuedAt: new Date(device.issuedAt).toLocaleString()
            })),
            totalDevices: activeDevices.length,
            maxDevices: tokenManager.MAX_CONCURRENT_DEVICES
        });
    });
}

// ================================================================
// 에러 처리 미들웨어
// ================================================================

router.use((error, req, res, next) => {
    console.error('[AUTH_ROUTER] 오류 발생:', error);
    
    // 토큰 관련 에러
    if (error.name === 'JsonWebTokenError') {
        return res.status(403).json({
            success: false,
            message: '유효하지 않은 토큰입니다.',
            error: 'INVALID_TOKEN'
        });
    }
    
    // 토큰 만료 에러
    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: '토큰이 만료되었습니다.',
            error: 'TOKEN_EXPIRED'
        });
    }
    
    // 인증 에러
    if (error.message.includes('authentication') || error.message.includes('authorization')) {
        return res.status(401).json({
            success: false,
            message: '인증이 필요합니다.',
            error: 'AUTHENTICATION_REQUIRED'
        });
    }
    
    // 기기 제한 에러
    if (error.message.includes('device') || error.message.includes('concurrent')) {
        return res.status(429).json({
            success: false,
            message: '동시 접속 기기 수를 초과했습니다.',
            error: 'DEVICE_LIMIT_EXCEEDED'
        });
    }
    
    // 기타 서버 오류
    res.status(500).json({
        success: false,
        message: '서버 내부 오류가 발생했습니다.',
        error: 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString()
    });
});

// ================================================================
// 라우터 정보 조회 (디버깅용)
// ================================================================

router.get('/routes', (req, res) => {
    const routes = [
        {
            method: 'POST',
            path: '/api/auth/request-code',
            description: '이메일 인증 코드 요청',
            protected: false
        },
        {
            method: 'POST',
            path: '/api/auth/verify-code',
            description: '인증 코드 검증 및 기기별 로그인',
            protected: false
        },
        {
            method: 'GET',
            path: '/api/auth/status',
            description: '인증 상태 확인 (기기 정보 포함)',
            protected: false
        },
        {
            method: 'POST',
            path: '/api/auth/logout',
            description: '로그아웃 (기기별/전체)',
            protected: true
        },
        {
            method: 'GET',
            path: '/api/auth/profile',
            description: '사용자 프로필 조회 (기기 정보 포함)',
            protected: true
        },
        {
            method: 'POST',
            path: '/api/auth/extend',
            description: '세션 연장',
            protected: false
        },
        {
            method: 'GET',
            path: '/api/auth/heartbeat',
            description: '하트비트 (활동 상태 확인)',
            protected: false
        },
        {
            method: 'GET',
            path: '/api/auth/session-events',
            description: 'SSE 실시간 세션 이벤트 (기기별)',
            protected: false
        },
        {
            method: 'GET',
            path: '/api/auth/devices',
            description: '사용자 활성 기기 목록 조회',
            protected: true
        },
        {
            method: 'DELETE',
            path: '/api/auth/devices/:deviceFingerprint',
            description: '특정 기기 강제 로그아웃',
            protected: true
        },
        {
            method: 'GET',
            path: '/api/auth/stats',
            description: '토큰 및 연결 통계',
            protected: true
        }
    ];
    
    if (process.env.NODE_ENV === 'development') {
        routes.push(
            {
                method: 'GET',
                path: '/api/auth/test-expiry',
                description: '토큰 강제 만료 테스트',
                protected: true
            },
            {
                method: 'GET',
                path: '/api/auth/test-device-limit',
                description: '기기 제한 현황 테스트',
                protected: true
            }
        );
    }
    
    res.json({
        success: true,
        routes,
        total: routes.length,
        environment: process.env.NODE_ENV || 'development',
        features: {
            deviceFingerprinting: true,
            concurrentDeviceLimit: true,
            sessionExtension: true,
            realTimeNotifications: true
        }
    });
});

module.exports = router;
