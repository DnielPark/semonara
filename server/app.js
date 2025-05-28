// ================================================================
// Semonara 서버 - 메인 애플리케이션 (ConnectionTracker 연동)
// 경로: /home/ubuntu/semonara/server/app.js
// 설명: Express 기반 웹 서버, API 및 정적 파일 서빙
// ================================================================

require('dotenv').config({ path: '../config/.env' });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const database = require('./database/connection');
const ideRouter = require('./routes/ide');

// ================================================================
// ConnectionTracker 및 TokenManager 연동 추가
// ================================================================
const connectionTracker = require('./middleware/connectionTracker');
const tokenManager = require('./services/TokenManager');

// 환경 설정
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Express 앱 생성
const app = express();
let server; // 글로벌 서버 변수

console.log('🚀 Starting Semonara Server in development mode...');

// ================================================================
// 미들웨어 설정 (순서 중요!)
// ================================================================

// 1. 보안 헤더 설정 (Helmet) - 개발용으로 완화
if (NODE_ENV === 'production') {
    // 프로덕션: 엄격한 보안
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
                fontSrc: ["'self'", "https:"],
                imgSrc: ["'self'", "data:", "https:"]
            }
        }
    }));
} else {
    // 개발: CSP 비활성화, 기본 보안만 적용
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: false,
        originAgentCluster: false
    }));
    console.log('🔧 Development mode: CSP and strict security policies disabled');
}

// 2. CORS 설정
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'https://www.semonara.com',
            'http://223.130.163.170:3000'
        ];
        
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

if (NODE_ENV === 'development') {
    corsOptions.origin = true; // 개발 모드에서는 모든 origin 허용
    console.log('🔧 Development mode: CORS allowing all origins');
}

app.use(cors(corsOptions));

// 3. JSON 파싱
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ================================================================
// 4. ConnectionTracker 미들웨어 적용 (핵심!)
// ================================================================
app.use((req, res, next) => {
    connectionTracker.trackRequest(req, res, next);
});

console.log('🌐 ConnectionTracker 미들웨어 적용 완료');

// 5. Rate Limiting - 개발 모드에서는 완화
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: NODE_ENV === 'development' ? 1000 : 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const emailLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: NODE_ENV === 'development' ? 100 : 10,
    message: { error: 'Too many email requests, please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5분
    max: NODE_ENV === 'development' ? 200 : 20,
    message: { error: 'Too many login attempts, please try again later.' }
});

// Rate limiter 적용
app.use('/api/', generalLimiter);
app.use('/api/auth/request-code', emailLimiter);
app.use('/api/auth/verify-code', loginLimiter);

// 6. 디바이스 감지 미들웨어
app.use((req, res, next) => {
    const userAgent = req.get('User-Agent') || '';
    const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
    req.device = {
        type: isMobile ? 'mobile' : 'desktop',
        userAgent: userAgent
    };
    res.set('X-Device-Type', req.device.type);
    next();
});

// 7. 요청 로깅 (개발 모드)
if (NODE_ENV === 'development') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms - ${res.get('Content-Length') || 0}`);
        });
        next();
    });
}

// ================================================================
// 정적 파일 서빙
// ================================================================
app.use(express.static(path.join(__dirname, '../client'), {
    maxAge: NODE_ENV === 'production' ? '1d' : '0'
}));

// ================================================================
// 라우트 설정
// ================================================================

// 루트 경로 → 로그인 페이지로 리다이렉트
app.get('/', (req, res) => {
    res.redirect('/mobile/login.html');
});

// ================================================================
// 새로운 ConnectionTracker 관련 API 엔드포인트
// ================================================================

// 하트비트 엔드포인트 (ConnectionTracker 위임)
app.get('/api/heartbeat', (req, res) => {
    connectionTracker.handleHeartbeat(req, res);
});

// 연결 상태 통계 조회
app.get('/api/connection-stats', (req, res) => {
    try {
        const stats = connectionTracker.getConnectionStats();
        res.json({
            success: true,
            timestamp: Date.now(),
            stats
        });
    } catch (error) {
        console.error('연결 통계 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '연결 통계를 조회할 수 없습니다.'
        });
    }
});

// 사용자별 연결 정보 조회
app.get('/api/user-connection/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const connectionInfo = connectionTracker.getUserConnectionInfo(userId);
        
        if (connectionInfo) {
            res.json({
                success: true,
                connectionInfo
            });
        } else {
            res.status(404).json({
                success: false,
                message: '사용자 연결 정보를 찾을 수 없습니다.'
            });
        }
    } catch (error) {
        console.error('사용자 연결 정보 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '연결 정보를 조회할 수 없습니다.'
        });
    }
});

// ================================================================
// 기존 API 엔드포인트들
// ================================================================

// 헬스 체크 엔드포인트 (ConnectionTracker 정보 추가)
app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const connectionStats = connectionTracker.getConnectionStats();
    const tokenStats = tokenManager.getStats();
    
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: uptime,
        memory: memoryUsage,
        device: req.device.type,
        security: {
            csp_enabled: NODE_ENV === 'production',
            cors_strict: NODE_ENV === 'production'
        },
        connections: connectionStats,
        tokens: tokenStats
    });
});

// API 상태 엔드포인트
app.get('/api/status', (req, res) => {
    res.json({
        service: 'Semonara API',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        endpoints: {
            auth: '/api/auth',
            archive: '/api/archive',
            server: '/api/server',
            heartbeat: '/api/heartbeat',
            connectionStats: '/api/connection-stats'
        },
        security_mode: NODE_ENV === 'development' ? 'relaxed' : 'strict'
    });
});

// 인증 관련 API 
app.use('/api/auth', require('./routes/api/auth'));

// IDE 라우터 등록
app.use('/ide', ideRouter);

// 아카이브(게시판) API  
// app.use('/api/archive', require('./routes/api/archive'));

// 서버 제어 API
// app.use('/api/server', require('./routes/api/server'));

// ================================================================
// 에러 처리 미들웨어
// ================================================================

// 404 에러 처리
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Path ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

// 500 에러 처리
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err);
    
    res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: NODE_ENV === 'development' ? err.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// ================================================================
// 서버 시작 함수
// ================================================================
async function startServer() {
    try {
        // 데이터베이스 연결
        await database.connect();
        console.log('✅ 데이터베이스 연결 완료');
        
        // 서버 시작
        server = app.listen(PORT, HOST, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🎉 Semonara Server Started Successfully!');
            console.log('='.repeat(60));
            console.log(`🌐 Environment: ${NODE_ENV}`);
            console.log(`🚀 Server URL: http://${HOST}:${PORT}`);
            console.log(`📱 Login Page: http://${HOST}:${PORT}/mobile/login.html`);
            console.log(`🇰🇷 Korean IDE: http://${HOST}:${PORT}/ide`);
            console.log(`🔧 Health Check: http://${HOST}:${PORT}/health`);
            console.log(`📊 API Status: http://${HOST}:${PORT}/api/status`);
            console.log('='.repeat(60));
            console.log('📋 Available Endpoints:');
            console.log('   GET  /                    → Redirect to login');
            console.log('   GET  /mobile/login.html   → Login page');
            console.log('   GET  /mobile/dashboard.html → Dashboard');
            console.log('   GET  /ide                 → Korean IDE');
            console.log('   GET  /health              → Health check');
            console.log('   GET  /api/status          → API status');
            console.log('   GET  /api/heartbeat       → Connection heartbeat');
            console.log('   GET  /api/connection-stats → Connection statistics');
            console.log('='.repeat(60));
            console.log('🛡️  Security & Monitoring Features:');
            
            if (NODE_ENV === 'development') {
                console.log('   🔧 CSP: DISABLED (개발 모드)');
                console.log('   🔧 CORS: ALL ORIGINS ALLOWED');
                console.log('   🔧 Rate Limits: RELAXED');
                console.log('   ✅ Error details enabled');
            } else {
                console.log('   ✅ Helmet security headers');
                console.log('   ✅ CORS protection');
                console.log('   ✅ Rate limiting');
                console.log('   ✅ CSP enabled');
            }
            
            console.log('   ✅ Device detection');
            console.log('   ✅ Error handling');
            console.log('   🌐 ConnectionTracker: ACTIVE');
            console.log('   🔐 TokenManager: ACTIVE');
            console.log('   📡 SSE Support: ENABLED');
            console.log('='.repeat(60));
            console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
            console.log(`🔄 Process ID: ${process.pid}`);
            console.log('='.repeat(60) + '\n');
            
            // 개발 모드에서만 추가 정보 표시
            if (NODE_ENV === 'development') {
                console.log('🔧 Development Mode Features:');
                console.log('   📝 Detailed error messages');
                console.log('   📊 Request logging');
                console.log('   🔄 Auto-restart with nodemon');
                console.log('   🌐 CORS allowing all origins');
                console.log('   🔓 CSP and strict security disabled');
                console.log('   📱 External IP access enabled');
                console.log('   🌐 Real-time connection tracking');
                console.log('   🔐 Advanced token management');
                console.log('='.repeat(60) + '\n');
                
                console.log('🌍 External Access URLs:');
                console.log(`   🖥️  Desktop: http://223.130.163.170:${PORT}`);
                console.log(`   📱 Mobile:  http://223.130.163.170:${PORT}/mobile/login.html`);
                console.log(`   🇰🇷 Korean IDE: http://223.130.163.170:${PORT}/ide`);
                console.log('='.repeat(60) + '\n');
                
                console.log('🔌 Real-time Features:');
                console.log('   📡 SSE Session Events: /api/auth/session-events');
                console.log('   💓 Heartbeat API: /api/heartbeat');
                console.log('   📊 Connection Stats: /api/connection-stats');
                console.log('   🔐 Token Statistics: /api/auth/stats');
                console.log('='.repeat(60) + '\n');
            }
        });
        
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// ================================================================
// Graceful Shutdown 처리 (ConnectionTracker 정리 포함)
// ================================================================
function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    if (server) {
        server.close((err) => {
            if (err) {
                console.error('❌ Error during graceful shutdown:', err);
                process.exit(1);
            } else {
                console.log('✅ Server closed gracefully');
                
                // 데이터베이스 연결 종료
                if (database) {
                    database.close();
                }
                
                // ConnectionTracker 정리
                try {
                    connectionTracker.cleanupInactiveConnections();
                    console.log('✅ ConnectionTracker cleaned up');
                } catch (error) {
                    console.error('⚠️ ConnectionTracker cleanup warning:', error.message);
                }
                
                // TokenManager 정리
                try {
                    tokenManager.cleanupExpiredTokens();
                    console.log('✅ TokenManager cleaned up');
                } catch (error) {
                    console.error('⚠️ TokenManager cleanup warning:', error.message);
                }
                
                process.exit(0);
            }
        });
    } else {
        process.exit(0);
    }
}

// 시그널 핸들러 등록
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    console.log('🛑 Received UNCAUGHT_EXCEPTION. Starting graceful shutdown...');
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🛑 Received UNHANDLED_REJECTION. Starting graceful shutdown...');
    gracefulShutdown('UNHANDLED_REJECTION');
});

// ================================================================
// 서버 시작
// ================================================================
startServer();

// 서버 정보를 모듈로 내보내기 (테스트용)
module.exports = { app, server };
