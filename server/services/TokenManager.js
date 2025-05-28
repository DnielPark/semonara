// ================================================================
// TokenManager - 기기별 실시간 토큰 관리 (업데이트 버전)
// 경로: /home/ubuntu/semonara/server/services/TokenManager.js
// ================================================================

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const EventEmitter = require('events');

class TokenManager extends EventEmitter {
    constructor() {
        super();
        
        // 기기별 토큰 저장소
        // Map<deviceFingerprint, {token, userId, email, ip, userAgent, deviceInfo, issuedAt, expiresAt, lastActivity, timer}>
        this.deviceTokens = new Map();
        
        // 사용자별 활성 기기 목록
        // Map<userId, Set<deviceFingerprint>>
        this.userDevices = new Map();
        
        // SSE 연결 관리 (기기별)
        // Map<deviceFingerprint, response객체>
        this.sseConnections = new Map();
        
        // 설정값
        this.JWT_SECRET = process.env.JWT_SECRET || 'semonara-secret-2025';
        this.TOKEN_EXPIRES_IN = process.env.NODE_ENV === 'development' ? '10m' : '30m';
        this.GRACE_PERIOD = 5 * 60 * 1000; // 5분 유예기간
        this.ACTIVITY_THRESHOLD = 2* 60 * 1000; // 30초에서 2분 변경 비활성 기준
        this.MAX_CONCURRENT_DEVICES = 3; // 최대 동시 접속 기기 수
        
        console.log(`🔐 Enhanced TokenManager 초기화 완료 - 최대 ${this.MAX_CONCURRENT_DEVICES}개 기기 동시 접속`);
        
        // 정리 작업
        setInterval(() => {
            this.cleanupExpiredTokens();
        }, 10 * 60 * 1000);
    }
    
    // ================================================================
    // 기기 식별 및 핑거프린팅
    // ================================================================
    
    /**
     * 기기 고유 식별자 생성
     */
    generateDeviceFingerprint(req) {
        const ip = this.getClientIP(req);
        const userAgent = req.get('User-Agent') || '';
        
        // 브라우저/기기 정보 추출
        const deviceInfo = this.parseDeviceInfo(userAgent);
        
        // 클라이언트에서 제공하는 추가 정보
        const clientFingerprint = req.headers['x-device-fingerprint'] || '';
        const sessionId = req.headers['x-session-id'] || '';
        
        // 고유 식별자 생성
        const fingerprintData = [
            ip,
            deviceInfo.browser,
            deviceInfo.os,
            deviceInfo.device,
            clientFingerprint,
            sessionId,
            Date.now().toString() // 타임스탬프 추가로 더 고유하게
        ].join('|');
        
        return crypto.createHash('sha256').update(fingerprintData).digest('hex').substring(0, 16);
    }
    
    /**
     * User-Agent에서 기기 정보 파싱
     */
    parseDeviceInfo(userAgent) {
        const ua = userAgent.toLowerCase();
        
        // 운영체제 감지
        let os = 'unknown';
        if (ua.includes('windows')) os = 'windows';
        else if (ua.includes('mac')) os = 'macos';
        else if (ua.includes('linux')) os = 'linux';
        else if (ua.includes('android')) os = 'android';
        else if (ua.includes('iphone') || ua.includes('ipad')) os = 'ios';
        
        // 브라우저 감지
        let browser = 'unknown';
        if (ua.includes('chrome') && !ua.includes('edg')) browser = 'chrome';
        else if (ua.includes('firefox')) browser = 'firefox';
        else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'safari';
        else if (ua.includes('edge') || ua.includes('edg')) browser = 'edge';
        
        // 기기 타입 감지
        let device = 'desktop';
        if (ua.includes('mobile')) device = 'mobile';
        else if (ua.includes('tablet') || ua.includes('ipad')) device = 'tablet';
        
        return { os, browser, device };
    }
    
    /**
     * 클라이언트 IP 추출
     */
    getClientIP(req) {
        return req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               req.ip || 
               'unknown';
    }
    
    // ================================================================
    // 토큰 발급 및 등록
    // ================================================================
    
    /**
     * 기기별 JWT 토큰 생성 및 등록
     */
    issueToken(email, userId, req) {
        const deviceFingerprint = this.generateDeviceFingerprint(req);
        const ip = this.getClientIP(req);
        const userAgent = req.get('User-Agent') || '';
        const deviceInfo = this.parseDeviceInfo(userAgent);
        
        console.log(`🔍 기기 식별: ${deviceFingerprint} - ${deviceInfo.device}/${deviceInfo.os}/${deviceInfo.browser}`);
        
        // 사용자의 현재 활성 기기 확인
        const userDeviceSet = this.userDevices.get(userId) || new Set();
        
        // 동일한 기기에서 이미 로그인된 경우 기존 토큰 무효화
        if (this.deviceTokens.has(deviceFingerprint)) {
            console.log(`🔄 기존 기기 토큰 갱신: ${deviceFingerprint}`);
            this.revokeDeviceToken(deviceFingerprint, '동일 기기 재로그인');
        }
        
        // 최대 동시 접속 기기 수 확인
        if (userDeviceSet.size >= this.MAX_CONCURRENT_DEVICES) {
            const oldestDevice = this.findOldestUserDevice(userId);
            if (oldestDevice) {
                this.revokeDeviceToken(oldestDevice, '최대 기기 수 초과로 인한 자동 로그아웃');
                console.log(`⚠️ 최대 기기 수 초과: 가장 오래된 기기 ${oldestDevice} 연결 해제`);
            }
        }
        
        // 새 토큰 생성
        const now = Date.now();
		let expiresIn;
		if (this.TOKEN_EXPIRES_IN === '10m') {
		    expiresIn = 10 * 60 * 1000;
		} else if (this.TOKEN_EXPIRES_IN === '30m') {
		    expiresIn = 30 * 60 * 1000;
		} else if (this.TOKEN_EXPIRES_IN === '1m') {
		    expiresIn = 60 * 1000;
		} else {
		    expiresIn = 30 * 60 * 1000;
		}
        const expiresAt = now + expiresIn;
        
        const token = jwt.sign({
            email,
            userId,
            deviceFingerprint,
            ip,
            deviceInfo,
            iat: Math.floor(now / 1000),
            exp: Math.floor(expiresAt / 1000)
        }, this.JWT_SECRET);
        
        // 기기별 토큰 저장
        const tokenData = {
            token,
            userId,
            email,
            ip,
            userAgent,
            deviceInfo,
            deviceFingerprint,
            issuedAt: now,
            expiresAt,
            lastActivity: now,
            timer: null
        };
        
        this.deviceTokens.set(deviceFingerprint, tokenData);
        
        // 사용자별 기기 목록 업데이트
        userDeviceSet.add(deviceFingerprint);
        this.userDevices.set(userId, userDeviceSet);
        
        // 만료 타이머 설정
        this.setExpiryTimer(deviceFingerprint, expiresIn);
        
        console.log(`🔑 기기별 토큰 발급: ${email} - ${deviceInfo.device}(${deviceInfo.os}) - ${deviceFingerprint}`);
        
        return token;
    }
    
    /**
     * 토큰 및 기기 정보 반환
     */
	issueTokenWithDeviceInfo(email, userId, req) {
	    // 먼저 핑거프린트 생성
	    const deviceFingerprint = this.generateDeviceFingerprint(req);
	    
	    // issueToken에 핑거프린트 전달하도록 수정하거나
	    // 또는 issueToken 후 바로 tokenData 가져오기
	    const token = this.issueToken(email, userId, req);
	    
	    // issueToken에서 실제로 사용된 핑거프린트로 다시 조회
	    // issueToken 메서드의 반환값을 수정하거나
	    // 다른 방법 사용
	    
	    // 임시 해결책: 모든 기기 토큰을 확인해서 가장 최근 것 찾기
	    let latestTokenData = null;
	    let latestTime = 0;
	    
	    for (const [fp, data] of this.deviceTokens.entries()) {
		if (data.userId === userId && data.issuedAt > latestTime) {
		    latestTime = data.issuedAt;
		    latestTokenData = data;
		}
	    }
	    
	    if (!latestTokenData) {
		console.error(`❌ 사용자 ${userId}의 TokenData를 찾을 수 없음`);
		throw new Error('토큰 생성 후 데이터를 찾을 수 없습니다.');
	    }
	    
	    return {
		token,
		deviceInfo: {
		    fingerprint: latestTokenData.deviceFingerprint,
		    ...latestTokenData.deviceInfo,
		    ip: latestTokenData.ip
		},
		expiresAt: latestTokenData.expiresAt,
		expiresIn: this.TOKEN_EXPIRES_IN
	    };
	}
    
    /**
     * 토큰 만료 타이머 설정
     */
    setExpiryTimer(deviceFingerprint, expiresIn) {
        const tokenData = this.deviceTokens.get(deviceFingerprint);
        if (!tokenData) return;
        
        if (tokenData.timer) {
            clearTimeout(tokenData.timer);
        }
        
        tokenData.timer = setTimeout(() => {
            this.handleTokenExpiry(deviceFingerprint);
        }, expiresIn);
        
        this.deviceTokens.set(deviceFingerprint, tokenData);
    }
    
    // ================================================================
    // 토큰 검증 및 관리
    // ================================================================
    
    /**
     * 기기별 토큰 검증
     */
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET);
            const deviceFingerprint = decoded.deviceFingerprint;
            
            if (!deviceFingerprint) {
                console.log(`❌ 토큰 검증 실패: 기기 핑거프린트 없음`);
                return null;
            }
            
            const tokenData = this.deviceTokens.get(deviceFingerprint);
            
            if (!tokenData || tokenData.token !== token) {
                console.log(`❌ 토큰 검증 실패: 기기 토큰 불일치 (${deviceFingerprint})`);
                return null;
            }
            
            if (Date.now() > tokenData.expiresAt) {
                console.log(`❌ 토큰 만료: ${deviceFingerprint}`);
                this.revokeDeviceToken(deviceFingerprint, '토큰 만료');
                return null;
            }
            
            // 활동 시간 업데이트
            this.updateActivity(token);
            
            return {
                ...decoded,
                ...tokenData
            };
            
        } catch (error) {
            console.log(`❌ 토큰 검증 실패: ${error.message}`);
            return null;
        }
    }
    
    /**
     * 사용자 활동 시간 업데이트
     */
    updateActivity(token, ip = null) {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET);
            const deviceFingerprint = decoded.deviceFingerprint;
            const tokenData = this.deviceTokens.get(deviceFingerprint);
            
            if (tokenData) {
                tokenData.lastActivity = Date.now();
                this.deviceTokens.set(deviceFingerprint, tokenData);
            }
        } catch (error) {
            // 토큰이 유효하지 않으면 무시
        }
    }
    
    // ================================================================
    // 토큰 무효화
    // ================================================================
    
    /**
     * 특정 기기 토큰 무효화
     */
    revokeDeviceToken(deviceFingerprint, reason = '수동 무효화', notifyUser = true) {
        const tokenData = this.deviceTokens.get(deviceFingerprint);
        if (!tokenData) return;
        
        const { userId, email, deviceInfo, timer } = tokenData;
        
        // 타이머 제거
        if (timer) {
            clearTimeout(timer);
        }
        
        // 기기별 토큰 삭제
        this.deviceTokens.delete(deviceFingerprint);
        
        // 사용자별 기기 목록에서 제거
        const userDeviceSet = this.userDevices.get(userId);
        if (userDeviceSet) {
            userDeviceSet.delete(deviceFingerprint);
            if (userDeviceSet.size === 0) {
                this.userDevices.delete(userId);
            }
        }
        
        // SSE 연결 정리
        const sseConnection = this.sseConnections.get(deviceFingerprint);
        if (sseConnection) {
            this.sseConnections.delete(deviceFingerprint);
        }
        
        console.log(`🚫 기기 토큰 무효화: ${email} - ${deviceInfo.device}(${deviceInfo.os}) - ${reason}`);
        
        // 사용자에게 알림
        if (notifyUser) {
            this.sendSSEMessage(deviceFingerprint, {
                type: 'session-revoked',
                title: '🚪 세션 종료',
                message: `${deviceInfo.device} 기기의 세션이 종료되었습니다. (${reason})`,
                reason,
                deviceInfo,
                action: 'redirect-to-login',
                timestamp: Date.now()
            });
        }
    }
    
    /**
     * 특정 토큰 무효화 (기존 인터페이스 호환)
     */
    revokeToken(token, reason = '수동 무효화', notifyUser = true) {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET);
            const deviceFingerprint = decoded.deviceFingerprint;
            
            if (deviceFingerprint) {
                this.revokeDeviceToken(deviceFingerprint, reason, notifyUser);
            }
        } catch (error) {
            // 토큰이 유효하지 않으면 무시
        }
    }
    
    /**
     * 사용자의 모든 기기 토큰 무효화
     */
    revokeUserTokens(userId, exceptDevice = null) {
        const userDeviceSet = this.userDevices.get(userId);
        if (!userDeviceSet) return;
        
        let revokedCount = 0;
        const devicesToRevoke = Array.from(userDeviceSet);
        
        for (const deviceFingerprint of devicesToRevoke) {
            if (deviceFingerprint !== exceptDevice) {
                this.revokeDeviceToken(deviceFingerprint, '사용자 전체 로그아웃', false);
                revokedCount++;
            }
        }
        
        console.log(`🔄 사용자 모든 기기 로그아웃: ${userId} - ${revokedCount}개 기기`);
    }
    
    /**
     * 가장 오래된 사용자 기기 찾기
     */
    findOldestUserDevice(userId) {
        const userDeviceSet = this.userDevices.get(userId);
        if (!userDeviceSet) return null;
        
        let oldestDevice = null;
        let oldestTime = Date.now();
        
        for (const deviceFingerprint of userDeviceSet) {
            const tokenData = this.deviceTokens.get(deviceFingerprint);
            if (tokenData && tokenData.issuedAt < oldestTime) {
                oldestTime = tokenData.issuedAt;
                oldestDevice = deviceFingerprint;
            }
        }
        
        return oldestDevice;
    }
    
    // ================================================================
    // 토큰 만료 처리
    // ================================================================
    
    /**
     * 토큰 만료 시 처리 로직
     */
    async handleTokenExpiry(deviceFingerprint) {
        const tokenData = this.deviceTokens.get(deviceFingerprint);
        if (!tokenData) return;
        
        const { userId, email, deviceInfo, lastActivity } = tokenData;
        const now = Date.now();
        const timeSinceActivity = now - lastActivity;
        
        console.log(`⏰ 토큰 만료 처리: ${email} - ${deviceInfo.device} - 마지막 활동: ${timeSinceActivity}ms 전`);
        
        const isRecentlyActive = timeSinceActivity < this.ACTIVITY_THRESHOLD;
        
        if (isRecentlyActive) {
            await this.notifyUserExpiry(deviceFingerprint, userId);
            this.startGracePeriod(deviceFingerprint);
        } else {
            this.revokeDeviceToken(deviceFingerprint, '비활성 상태로 인한 자동 만료');
        }
    }
    
    /**
     * 사용자에게 토큰 만료 알림 발송
     */
    async notifyUserExpiry(deviceFingerprint, userId) {
        const tokenData = this.deviceTokens.get(deviceFingerprint);
        if (!tokenData) return;
        
        const message = {
            type: 'session-expiring',
            title: '🔐 세션 만료 알림',
            message: `${tokenData.deviceInfo.device} 기기의 로그인 세션이 만료되었습니다.`,
            remainingTime: this.GRACE_PERIOD / 1000,
            deviceInfo: tokenData.deviceInfo,
            actions: {
                extend: {
                    label: '세션 연장',
                    url: `/api/auth/extend`
                },
                logout: {
                    label: '로그아웃',
                    url: '/api/auth/logout'
                }
            },
            timestamp: Date.now()
        };
        
        this.sendSSEMessage(deviceFingerprint, message);
        console.log(`📨 만료 알림 발송: ${tokenData.email} - ${tokenData.deviceInfo.device}`);
    }
    
    /**
     * 유예기간 시작
     */
    startGracePeriod(deviceFingerprint) {
        const tokenData = this.deviceTokens.get(deviceFingerprint);
        if (!tokenData) return;
        
        console.log(`⏳ 유예기간 시작: ${tokenData.deviceInfo.device} - ${this.GRACE_PERIOD / 1000}초`);
        
        tokenData.timer = setTimeout(() => {
            this.revokeDeviceToken(deviceFingerprint, '유예기간 초과');
        }, this.GRACE_PERIOD);
        
        this.deviceTokens.set(deviceFingerprint, tokenData);
    }
    
    // ================================================================
    // 세션 연장
    // ================================================================
    
    /**
     * 토큰 연장 (새 토큰 발급)
     */
    extendToken(oldToken) {
        try {
            const decoded = jwt.verify(oldToken, this.JWT_SECRET);
            const deviceFingerprint = decoded.deviceFingerprint;
            const tokenData = this.deviceTokens.get(deviceFingerprint);
            
            if (!tokenData) {
                console.log(`❌ 연장 실패: 기기 토큰을 찾을 수 없음`);
                return null;
            }
            
            const { userId, email, ip, userAgent, deviceInfo } = tokenData;
            
            // 새 토큰 생성
            const now = Date.now();
		let expiresIn;
		if (this.TOKEN_EXPIRES_IN === '10m') {
		    expiresIn = 10 * 60 * 1000;
		} else if (this.TOKEN_EXPIRES_IN === '30m') {
		    expiresIn = 30 * 60 * 1000;
		} else if (this.TOKEN_EXPIRES_IN === '1m') {
		    expiresIn = 60 * 1000;
		} else {
		    expiresIn = 30 * 60 * 1000;
		}

            const expiresAt = now + expiresIn;
            
            const newToken = jwt.sign({
                email,
                userId,
                deviceFingerprint,
                ip,
                deviceInfo,
                iat: Math.floor(now / 1000),
                exp: Math.floor(expiresAt / 1000)
            }, this.JWT_SECRET);
            
            // 기존 타이머 제거
            if (tokenData.timer) {
                clearTimeout(tokenData.timer);
            }
            
            // 토큰 데이터 업데이트
            tokenData.token = newToken;
            tokenData.issuedAt = now;
            tokenData.expiresAt = expiresAt;
            tokenData.lastActivity = now;
            
            this.deviceTokens.set(deviceFingerprint, tokenData);
            
            // 새 만료 타이머 설정
            this.setExpiryTimer(deviceFingerprint, expiresIn);
            
            console.log(`🔄 토큰 연장 성공: ${email} - ${deviceInfo.device}`);
            
            // 연장 성공 알림
            this.sendSSEMessage(deviceFingerprint, {
                type: 'session-extended',
                title: '✅ 세션 연장 완료',
                message: `${deviceInfo.device} 기기의 세션이 연장되었습니다.`,
                newToken,
                deviceInfo,
                timestamp: Date.now()
            });
            
            return newToken;
            
        } catch (error) {
            console.log(`❌ 토큰 연장 실패: ${error.message}`);
            return null;
        }
    }
    
    // ================================================================
    // SSE 관리
    // ================================================================
    
    /**
     * SSE 연결 등록 (기기별)
     */
    registerSSEConnection(token, response) {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET);
            const deviceFingerprint = decoded.deviceFingerprint;
            
            this.sseConnections.set(deviceFingerprint, response);
            console.log(`📡 SSE 연결 등록: ${deviceFingerprint}`);
            
            response.on('close', () => {
                this.sseConnections.delete(deviceFingerprint);
                console.log(`📡 SSE 연결 해제: ${deviceFingerprint}`);
            });
            
        } catch (error) {
            console.error(`📡 SSE 등록 실패: ${error.message}`);
        }
    }
    
    /**
     * 특정 기기에게 SSE 메시지 발송
     */
    sendSSEMessage(deviceFingerprint, message) {
        const connection = this.sseConnections.get(deviceFingerprint);
        if (!connection || connection.destroyed) {
            return;
        }
        
        try {
            const data = JSON.stringify(message);
            connection.write(`data: ${data}\n\n`);
            console.log(`📡 SSE 메시지 발송: ${deviceFingerprint} - ${message.type}`);
        } catch (error) {
            console.error(`📡 SSE 발송 오류: ${error.message}`);
            this.sseConnections.delete(deviceFingerprint);
        }
    }
    
    // ================================================================
    // 기기 및 통계 조회
    // ================================================================
    
    /**
     * 사용자의 활성 기기 목록 조회
     */
    getUserActiveDevices(userId) {
        const userDeviceSet = this.userDevices.get(userId);
        if (!userDeviceSet) return [];
        
        const devices = [];
        for (const deviceFingerprint of userDeviceSet) {
            const tokenData = this.deviceTokens.get(deviceFingerprint);
            if (tokenData) {
                devices.push({
                    deviceFingerprint,
                    deviceInfo: tokenData.deviceInfo,
                    ip: tokenData.ip,
                    lastActivity: tokenData.lastActivity,
                    issuedAt: tokenData.issuedAt,
                    userAgent: tokenData.userAgent,
                    expiresAt: tokenData.expiresAt
                });
            }
        }
        
        devices.sort((a, b) => b.lastActivity - a.lastActivity);
        return devices;
    }
    
    /**
     * 만료된 토큰 정리
     */
    cleanupExpiredTokens() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [deviceFingerprint, tokenData] of this.deviceTokens.entries()) {
            if (now > tokenData.expiresAt + this.GRACE_PERIOD) {
                this.revokeDeviceToken(deviceFingerprint, '주기적 정리', false);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 만료된 토큰 정리: ${cleanedCount}개 기기`);
        }
    }
    
    /**
     * 통계 정보
     */
    getStats() {
        const totalDevices = this.deviceTokens.size;
        const totalUsers = this.userDevices.size;
        let expiringSoon = 0;
        let recentlyActive = 0;
        
        const deviceTypeStats = {};
        const osStats = {};
        const browserStats = {};
        
        const now = Date.now();
        
        for (const [fingerprint, tokenData] of this.deviceTokens.entries()) {
            const timeToExpiry = tokenData.expiresAt - now;
            const timeSinceActivity = now - tokenData.lastActivity;
            
            if (timeToExpiry < 5 * 60 * 1000) {
                expiringSoon++;
            }
            
            if (timeSinceActivity < this.ACTIVITY_THRESHOLD) {
                recentlyActive++;
            }
            
            const { deviceInfo } = tokenData;
            deviceTypeStats[deviceInfo.device] = (deviceTypeStats[deviceInfo.device] || 0) + 1;
            osStats[deviceInfo.os] = (osStats[deviceInfo.os] || 0) + 1;
            browserStats[deviceInfo.browser] = (browserStats[deviceInfo.browser] || 0) + 1;
        }
        
        return {
            totalActiveTokens: totalDevices,
            totalUsers,
            maxConcurrentDevices: this.MAX_CONCURRENT_DEVICES,
            sseConnections: this.sseConnections.size,
            expiringSoon,
            recentlyActive,
            tokenExpiresIn: this.TOKEN_EXPIRES_IN,
            gracePeriod: this.GRACE_PERIOD / 1000,
            activityThreshold: this.ACTIVITY_THRESHOLD / 1000,
            deviceTypeStats,
            osStats,
            browserStats
        };
    }
}

// 싱글톤 인스턴스 생성
const tokenManager = new TokenManager();

module.exports = tokenManager;
