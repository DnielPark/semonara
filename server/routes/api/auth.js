// ================================================================
// 인증 API 라우트 파일
// 경로: /home/ubuntu/semonara/server/routes/api/auth.js
// 설명: 이메일 인증, JWT 토큰 관리 라우트
// ================================================================

const express = require('express');
const router = express.Router();
const authController = require('../../middleware/auth');

// ================================================================
// 인증 관련 API 라우트
// ================================================================

/**
 * POST /api/auth/request-code
 * 이메일 인증 코드 요청
 */
router.post('/request-code', authController.requestEmailCode);

/**
 * POST /api/auth/verify-code  
 * 인증 코드 검증 및 로그인
 */
router.post('/verify-code', authController.verifyEmailCode);

/**
 * GET /api/auth/status
 * 현재 인증 상태 확인
 */
router.get('/status', authController.checkAuthStatus);

/**
 * POST /api/auth/logout
 * 로그아웃 (토큰 무효화)
 */
router.post('/logout', authController.authenticateToken, authController.logout);

/**
 * GET /api/auth/profile
 * 사용자 프로필 정보 (보호된 라우트 예시)
 */
router.get('/profile', authController.authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: {
            email: req.user.email,
            userId: req.user.userId,
            loginTime: new Date(req.user.iat * 1000).toISOString(),
            expiresAt: new Date(req.user.exp * 1000).toISOString()
        }
    });
});

module.exports = router;
