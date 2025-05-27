require('dotenv').config({ path: '../config/.env' });
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const database = require('../database/connection');
const User = require('../database/models/User');

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
 * JWT 토큰 생성 (30분 유효)
 */
function generateToken(email, userId) {
    return jwt.sign(
        { 
            email, 
            userId,
            iat: Math.floor(Date.now() / 1000) 
        },
        JWT_SECRET,
        { expiresIn: '30m' }
    );
}

/**
 * JWT 토큰 검증
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
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
 * 인증 코드 검증 API
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

        // 인증 성공
        await User.updateLastLogin(email);
        const token = generateToken(email, user.id);

        res.json({
            success: true,
            message: '인증 완료',
            token
        });

        console.log(`[AUTH] 로그인 성공: ${email}`);

    } catch (error) {
        console.error('[AUTH] 인증 실패:', error);
        res.status(500).json({
            success: false,
            message: '인증 처리 실패'
        });
    }
}

/**
 * 토큰 인증 미들웨어 (중요!)
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

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(403).json({
            success: false,
            message: '유효하지 않은 토큰입니다.'
        });
    }

    if (decoded.email !== AUTHORIZED_EMAIL) {
        return res.status(403).json({
            success: false,
            message: '접근 권한이 없습니다.'
        });
    }

    req.user = decoded;
    next();
}

/**
 * 인증 상태 확인 API
 */
function checkAuthStatus(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.json({ authenticated: false });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.json({ authenticated: false });
    }

    res.json({
        authenticated: true,
        email: decoded.email,
        userId: decoded.userId,
        expiresAt: decoded.exp * 1000
    });
}

/**
 * 로그아웃 API
 */
function logout(req, res) {
    res.json({
        success: true,
        message: '로그아웃 완료'
    });
}

module.exports = {
    requestEmailCode,
    verifyEmailCode,
    authenticateToken,
    checkAuthStatus,
    logout
};
