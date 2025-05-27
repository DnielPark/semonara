const database = require('../connection');
const schema = require('../schema');

async function runMigration() {
    try {
        console.log('=== 데이터베이스 초기화 시작 ===');
        
        // 데이터베이스 연결
        await database.connect();
        
        // 테이블 생성
        console.log('테이블 생성 중...');
        for (const [tableName, createSQL] of Object.entries(schema.tables)) {
            console.log(`- ${tableName} 테이블 생성`);
            await database.run(createSQL);
        }
        
        // 인덱스 생성
        console.log('인덱스 생성 중...');
        for (const indexSQL of schema.indexes) {
            console.log(`- 인덱스 생성: ${indexSQL.split(' ')[5]}`);
            await database.run(indexSQL);
        }
        
        // 테이블 목록 확인
        console.log('\n=== 생성된 테이블 확인 ===');
        const tables = await database.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `);
        
        tables.forEach(table => {
            console.log(`✓ ${table.name}`);
        });
        
        console.log('\n=== 데이터베이스 초기화 완료 ===');
        
    } catch (error) {
        console.error('마이그레이션 실패:', error);
        process.exit(1);
    } finally {
        database.close();
    }
}

// 직접 실행된 경우에만 마이그레이션 실행
if (require.main === module) {
    runMigration();
}

module.exports = runMigration;
