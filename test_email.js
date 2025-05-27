// 이메일 발송 테스트 스크립트
require('dotenv').config({ path: './config/.env' });
const nodemailer = require('nodemailer');

console.log('=== Semonara 이메일 테스트 ===');
console.log('시작 시간:', new Date().toLocaleString());

// 환경변수 확인
console.log('\n📋 환경변수 확인:');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? '✅ 설정됨' : '❌ 없음');
console.log('EMAIL_APP_PASSWORD:', process.env.EMAIL_APP_PASSWORD ? '✅ 설정됨' : '❌ 없음');
console.log('EMAIL_TO:', process.env.EMAIL_TO ? '✅ 설정됨' : '❌ 없음');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅ 설정됨' : '❌ 없음');

if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD || !process.env.EMAIL_TO) {
    console.log('\n❌ 필수 환경변수가 설정되지 않았습니다.');
    console.log('config/.env 파일을 확인해주세요.');
    process.exit(1);
}

// Gmail 트랜스포터 생성
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

// 테스트 코드 생성
const testCode = Math.floor(100000 + Math.random() * 900000).toString();

// 이메일 옵션
const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO,
    subject: 'Semonara 테스트 이메일',
    text: `테스트 인증 코드: ${testCode}`
};

console.log('\n📧 이메일 발송 시도...');
console.log('발신자:', process.env.EMAIL_USER);
console.log('수신자:', process.env.EMAIL_TO);
console.log('테스트 코드:', testCode);

// 이메일 발송
transporter.sendMail(mailOptions)
    .then((info) => {
        console.log('\n✅ 이메일 발송 성공!');
        console.log('Message ID:', info.messageId);
        console.log('Response:', info.response);
        console.log('\n📱 이메일을 확인해보세요!');
        process.exit(0);
    })
    .catch((error) => {
        console.log('\n❌ 이메일 발송 실패:');
        console.error(error.message);
        
        // 일반적인 에러 해결 방법 안내
        console.log('\n🔧 해결 방법:');
        console.log('1. Gmail 앱 비밀번호가 올바른지 확인');
        console.log('2. Gmail 2단계 인증이 켜져 있는지 확인'); 
        console.log('3. "보안 수준이 낮은 앱의 액세스" 설정 확인');
        console.log('4. 네트워크 연결 상태 확인');
        
        process.exit(1);
    });
