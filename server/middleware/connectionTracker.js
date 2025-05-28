// ================================================================
// ConnectionTracker - 실시간 사용자 접속 상태 추적 미들웨어
// 경로: /home/ubuntu/semonara/server/middleware/connectionTracker.js
// 설명: IP별 접속 상태 모니터링 및 활동 시간 추적
// ================================================================

const tokenManager = require('../services/TokenManager');

class ConnectionTracker {
    constructor() {
        // IP별 접속 상태 추적
        // Map<ip, {userId, lastHeartbeat, userAgent, totalRequests, connectionStart}>
        this.activeConnections = new Map();
        
        // 하트비트 간격 (10초마다 체크)
        this.HEARTBEAT_INTERVAL = 10 * 1000;
        
        // 연결 타임아웃 (30초 무응답시 연결 종료 간주)
        this.CONNECTION_TIMEOUT = 30 * 1000;
        
        console.log('🌐 ConnectionTracker 초기화 완료');
        
        // 주기적으로 비활성 연결 정리
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, this.HEARTBEAT_INTERVAL);
    }
    
    /**
     * 요청 추적 미들웨어
     * @param {object} req - Express request 객체
     * @param {object} res - Express response 객체
     * @param {function} next - 다음 미들웨어 함수
     */
    trackRequest(req, res, next) {
        const ip = this.getClientIP(req);
        const userAgent = req.get('User-Agent') || 'Unknown';
        const now = Date.now();
        
        // Authorization 헤더에서 토큰 추출
        const token = this.extractToken(req);
        
        if (token) {
            // 토큰이 있는 경우: 활동 시간 업데이트
            const tokenData = tokenManager.verifyToken(token);
            if (tokenData) {
                // 유효한 토큰인 경우 활동 시간 업데이트
                tokenManager.updateActivity(token, ip);
                
                // 연결 상태 정보 업데이트
                this.updateConnection(ip, tokenData.userId, userAgent, now);
                
                // 요청 헤더에 사용자 정보 추가
                req.user = tokenData;
                req.clientIP = ip;
                req.lastActivity = now;
                
                console.log(`🔄 활동 추적: ${tokenData.email} (${ip}) - ${req.method} ${req.path}`);
            }
        } else {
            // 토큰이 없는 경우: 익명 접속 추적
            this.updateAnonymousConnection(ip, userAgent, now);
        }
        
        // 응답 완료 시 통계 업데이트
        res.on('finish', () => {
            this.updateConnectionStats(ip, req.method, res.statusCode);
        });
        
        next();
    }
    
    /**
     * 클라이언트 IP 주소 추출
     * @param {object} req - Express request 객체
     * @returns {string} IP 주소
     */
    getClientIP(req) {
        return req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               req.ip || 
               'unknown';
    }
    
    /**
     * Authorization 헤더에서 JWT 토큰 추출
     * @param {object} req - Express request 객체
     * @returns {string|null} 토큰 또는 null
     */
    extractToken(req) {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return null;
    }
    
    /**
     * 연결 상태 정보 업데이트 (인증된 사용자)
     * @param {string} ip - IP 주소
     * @param {string} userId - 사용자 ID
     * @param {string} userAgent - User Agent 정보
     * @param {number} timestamp - 타임스탬프
     */
    updateConnection(ip, userId, userAgent, timestamp) {
        const existing = this.activeConnections.get(ip);
        
        if (existing) {
            // 기존 연결 업데이트
            existing.userId = userId;
            existing.lastHeartbeat = timestamp;
            existing.userAgent = userAgent;
            existing.totalRequests = (existing.totalRequests || 0) + 1;
        } else {
            // 새 연결 등록
            this.activeConnections.set(ip, {
                userId,
                lastHeartbeat: timestamp,
                userAgent,
                totalRequests: 1,
                connectionStart: timestamp,
                isAuthenticated: true
            });
            
            console.log(`🟢 새 연결 등록: ${userId} (${ip})`);
        }
    }
    
    /**
     * 익명 연결 상태 업데이트
     * @param {string} ip - IP 주소
     * @param {string} userAgent - User Agent 정보
     * @param {number} timestamp - 타임스탬프
     */
    updateAnonymousConnection(ip, userAgent, timestamp) {
        const existing = this.activeConnections.get(ip);
        
        if (existing && !existing.isAuthenticated) {
            // 기존 익명 연결 업데이트
            existing.lastHeartbeat = timestamp;
            existing.totalRequests = (existing.totalRequests || 0) + 1;
        } else if (!existing) {
            // 새 익명 연결 등록
            this.activeConnections.set(ip, {
                userId: null,
                lastHeartbeat: timestamp,
                userAgent,
                totalRequests: 1,
                connectionStart: timestamp,
                isAuthenticated: false
            });
        }
    }
    
    /**
     * 연결 통계 업데이트
     * @param {string} ip - IP 주소
     * @param {string} method - HTTP 메서드
     * @param {number} statusCode - HTTP 상태 코드
     */
    updateConnectionStats(ip, method, statusCode) {
        const connection = this.activeConnections.get(ip);
        if (!connection) return;
        
        // 통계 정보 초기화
        if (!connection.stats) {
            connection.stats = {
                methods: {},
                statusCodes: {},
                lastRequest: null
            };
        }
        
        // 메서드별 통계
        connection.stats.methods[method] = (connection.stats.methods[method] || 0) + 1;
        
        // 상태 코드별 통계
        connection.stats.statusCodes[statusCode] = (connection.stats.statusCodes[statusCode] || 0) + 1;
        
        // 마지막 요청 정보
        connection.stats.lastRequest = {
            method,
            statusCode,
            timestamp: Date.now()
        };
        
        this.activeConnections.set(ip, connection);
    }
    
    /**
     * 비활성 연결 정리
     */
    cleanupInactiveConnections() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [ip, connection] of this.activeConnections.entries()) {
            const timeSinceLastHeartbeat = now - connection.lastHeartbeat;
            
            if (timeSinceLastHeartbeat > this.CONNECTION_TIMEOUT) {
                // 연결 종료 로그
                if (connection.isAuthenticated) {
                    console.log(`🔴 연결 종료: ${connection.userId} (${ip}) - ${timeSinceLastHeartbeat}ms 비활성`);
                }
                
                this.activeConnections.delete(ip);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 비활성 연결 정리: ${cleanedCount}개 제거`);
        }
    }
    
    /**
     * 특정 IP의 연결 상태 확인
     * @param {string} ip - IP 주소
     * @returns {boolean} 연결 상태
     */
    isConnected(ip) {
        const connection = this.activeConnections.get(ip);
        if (!connection) return false;
        
        const timeSinceLastHeartbeat = Date.now() - connection.lastHeartbeat;
        return timeSinceLastHeartbeat < this.CONNECTION_TIMEOUT;
    }
    
    /**
     * 특정 사용자의 연결 상태 확인
     * @param {string} userId - 사용자 ID
     * @returns {boolean} 연결 상태
     */
    isUserConnected(userId) {
        for (const [ip, connection] of this.activeConnections.entries()) {
            if (connection.userId === userId && this.isConnected(ip)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * 하트비트 엔드포인트 핸들러
     * @param {object} req - Express request 객체
     * @param {object} res - Express response 객체
     */
    handleHeartbeat(req, res) {
        const ip = this.getClientIP(req);
        const token = this.extractToken(req);
        
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
        
        // 활동 시간 업데이트
        tokenManager.updateActivity(token, ip);
        this.updateConnection(ip, tokenData.userId, req.get('User-Agent'), Date.now());
        
        // 토큰 정보 반환
        res.json({
            success: true,
            message: '하트비트 성공',
            tokenInfo: {
                userId: tokenData.userId,
                email: tokenData.email,
                expiresAt: tokenData.expiresAt,
                remainingTime: Math.max(0, tokenData.expiresAt - Date.now())
            },
            connectionInfo: {
                ip,
                lastActivity: Date.now(),
                isConnected: true
            }
        });
    }
    
    /**
     * 연결 상태 통계 조회
     * @returns {object} 연결 통계 정보
     */
    getConnectionStats() {
        const now = Date.now();
        let totalConnections = 0;
        let authenticatedConnections = 0;
        let anonymousConnections = 0;
        let activeConnections = 0;
        
        for (const [ip, connection] of this.activeConnections.entries()) {
            totalConnections++;
            
            if (connection.isAuthenticated) {
                authenticatedConnections++;
            } else {
                anonymousConnections++;
            }
            
            const timeSinceLastHeartbeat = now - connection.lastHeartbeat;
            if (timeSinceLastHeartbeat < this.CONNECTION_TIMEOUT) {
                activeConnections++;
            }
        }
        
        return {
            totalConnections,
            authenticatedConnections,
            anonymousConnections,
            activeConnections,
            heartbeatInterval: this.HEARTBEAT_INTERVAL / 1000,
            connectionTimeout: this.CONNECTION_TIMEOUT / 1000,
            lastCleanup: now
        };
    }
    
    /**
     * 특정 사용자의 연결 상세 정보 조회
     * @param {string} userId - 사용자 ID
     * @returns {object|null} 연결 정보 또는 null
     */
    getUserConnectionInfo(userId) {
        for (const [ip, connection] of this.activeConnections.entries()) {
            if (connection.userId === userId) {
                const now = Date.now();
                const timeSinceLastHeartbeat = now - connection.lastHeartbeat;
                const sessionDuration = now - connection.connectionStart;
                
                return {
                    ip,
                    userId: connection.userId,
                    isConnected: timeSinceLastHeartbeat < this.CONNECTION_TIMEOUT,
                    lastHeartbeat: connection.lastHeartbeat,
                    timeSinceLastHeartbeat,
                    sessionDuration,
                    totalRequests: connection.totalRequests,
                    userAgent: connection.userAgent,
                    stats: connection.stats || {}
                };
            }
        }
        return null;
    }
}

// 싱글톤 인스턴스 생성
const connectionTracker = new ConnectionTracker();

module.exports = connectionTracker;
