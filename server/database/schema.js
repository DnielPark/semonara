// 테이블 생성 SQL 문들

const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        auth_code TEXT,
        code_expires_at DATETIME,
        last_login DATETIME,
        login_attempts INTEGER DEFAULT 0,
        is_blocked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

const createPostsTable = `
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('서버기록', '투자일지', '개발노트')),
        tags TEXT,
        is_favorite BOOLEAN DEFAULT 0,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

const createServerLogsTable = `
    CREATE TABLE IF NOT EXISTS server_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        command TEXT,
        result TEXT,
        status TEXT CHECK (status IN ('success', 'error', 'warning')),
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

const createSystemStatusTable = `
    CREATE TABLE IF NOT EXISTS system_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cpu_usage REAL,
        memory_usage REAL,
        disk_usage REAL,
        active_processes INTEGER,
        nginx_status TEXT CHECK (nginx_status IN ('running', 'stopped')),
        pm2_status TEXT CHECK (pm2_status IN ('running', 'stopped')),
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

// 인덱스 생성 SQL 문들
const createIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category)',
    'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_favorite ON posts(is_favorite)',
    'CREATE INDEX IF NOT EXISTS idx_server_logs_action ON server_logs(action)',
    'CREATE INDEX IF NOT EXISTS idx_server_logs_created_at ON server_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_system_status_recorded_at ON system_status(recorded_at)'
];

module.exports = {
    tables: {
        users: createUsersTable,
        posts: createPostsTable,
        server_logs: createServerLogsTable,
        system_status: createSystemStatusTable
    },
    indexes: createIndexes
};
