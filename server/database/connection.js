const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 데이터베이스 파일 경로
const DB_PATH = path.join(__dirname, '../../storage/database/semonara.db');

class Database {
    constructor() {
        this.db = null;
    }

    // 데이터베이스 연결
    connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('데이터베이스 연결 실패:', err.message);
                    reject(err);
                } else {
                    console.log('SQLite 데이터베이스 연결 성공');
                    // 외래키 제약조건 활성화
                    this.db.run('PRAGMA foreign_keys = ON');
                    resolve();
                }
            });
        });
    }

    // 데이터베이스 연결 종료
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('데이터베이스 연결 종료 실패:', err.message);
                } else {
                    console.log('데이터베이스 연결 종료');
                }
            });
        }
    }

    // 쿼리 실행 (SELECT)
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // 쿼리 실행 (SELECT ALL)
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // 쿼리 실행 (INSERT, UPDATE, DELETE)
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ 
                        lastID: this.lastID, 
                        changes: this.changes 
                    });
                }
            });
        });
    }
}

// 싱글톤 인스턴스
const database = new Database();

module.exports = database;
