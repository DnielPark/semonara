const database = require('../connection');

class User {
    // 이메일로 사용자 조회
    static async findByEmail(email) {
        const sql = 'SELECT * FROM users WHERE email = ?';
        return await database.get(sql, [email]);
    }

    // 사용자 생성 또는 업데이트
    static async createOrUpdate(email, authCode, expiresAt) {
        const existingUser = await this.findByEmail(email);
        
        if (existingUser) {
            // 기존 사용자 업데이트
            const sql = `
                UPDATE users 
                SET auth_code = ?, code_expires_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE email = ?
            `;
            await database.run(sql, [authCode, expiresAt, email]);
            return await this.findByEmail(email);
        } else {
            // 새 사용자 생성
            const sql = `
                INSERT INTO users (email, auth_code, code_expires_at)
                VALUES (?, ?, ?)
            `;
            const result = await database.run(sql, [email, authCode, expiresAt]);
            return await this.findById(result.lastID);
        }
    }

    // ID로 사용자 조회
    static async findById(id) {
        const sql = 'SELECT * FROM users WHERE id = ?';
        return await database.get(sql, [id]);
    }

    // 인증 코드 검증
    static async verifyCode(email, code) {
        const sql = `
            SELECT * FROM users 
            WHERE email = ? AND auth_code = ? AND code_expires_at > CURRENT_TIMESTAMP
        `;
        return await database.get(sql, [email, code]);
    }

    // 로그인 시간 업데이트
    static async updateLastLogin(email) {
        const sql = `
            UPDATE users 
            SET last_login = CURRENT_TIMESTAMP, login_attempts = 0, auth_code = NULL
            WHERE email = ?
        `;
        return await database.run(sql, [email]);
    }

    // 로그인 시도 횟수 증가
    static async incrementLoginAttempts(email) {
        const sql = `
            UPDATE users 
            SET login_attempts = login_attempts + 1, updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        `;
        return await database.run(sql, [email]);
    }

    // 사용자 차단
    static async blockUser(email, blockUntil) {
        const sql = `
            UPDATE users 
            SET is_blocked_until = ?, updated_at = CURRENT_TIMESTAMP
            WHERE email = ?
        `;
        return await database.run(sql, [blockUntil, email]);
    }

    // 차단 상태 확인
    static async isBlocked(email) {
        const sql = `
            SELECT is_blocked_until FROM users 
            WHERE email = ? AND is_blocked_until > CURRENT_TIMESTAMP
        `;
        const result = await database.get(sql, [email]);
        return !!result;
    }
}

module.exports = User;
