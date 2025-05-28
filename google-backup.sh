#!/bin/bash
# ================================================================
# Semonara Google Drive 백업 스크립트
# 파일명: google-backup.sh
# 작성일: 2025년 5월 27일
# 설명: Semonara 프로젝트를 구글 드라이브에 자동 백업
# ================================================================

# 색상 코드 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정 변수
PROJECT_PATH="/home/ubuntu/semonara"
GDRIVE_REMOTE="DnielPark"
BACKUP_FOLDER="semonara"
LOG_FILE="/home/ubuntu/semonara/storage/logs/backup.log"

# 로그 디렉토리 생성
mkdir -p "$(dirname "$LOG_FILE")"

# 로깅 함수
log_message() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

# 색상 출력 함수
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
    log_message "INFO" "$message"
}

print_error() {
    local message=$1
    echo -e "${RED}❌ $message${NC}"
    log_message "ERROR" "$message"
}

print_success() {
    local message=$1
    echo -e "${GREEN}✅ $message${NC}"
    log_message "SUCCESS" "$message"
}

print_warning() {
    local message=$1
    echo -e "${YELLOW}⚠️  $message${NC}"
    log_message "WARNING" "$message"
}

# 헤더 출력
print_header() {
    echo
    echo "================================================================"
    echo "🚀 Semonara Google Drive 백업 스크립트"
    echo "================================================================"
    echo "📁 프로젝트 경로: $PROJECT_PATH"
    echo "☁️  구글 드라이브: $GDRIVE_REMOTE:$BACKUP_FOLDER"
    echo "📅 실행 시간: $(date '+%Y년 %m월 %d일 %H:%M:%S')"
    echo "================================================================"
    echo
}

# rclone 설치 확인
check_rclone() {
    print_status "$BLUE" "🔍 rclone 설치 상태 확인 중..."
    
    if ! command -v rclone &> /dev/null; then
        print_error "rclone이 설치되지 않았습니다."
        echo "설치 명령어: sudo apt install rclone"
        exit 1
    fi
    
    local rclone_version=$(rclone version | head -n1)
    print_success "rclone 설치 확인: $rclone_version"
}

# 구글 드라이브 연결 확인
check_gdrive_connection() {
    print_status "$BLUE" "🔗 구글 드라이브 연결 상태 확인 중..."
    
    if ! rclone lsd "$GDRIVE_REMOTE:" &> /dev/null; then
        print_error "구글 드라이브 연결에 실패했습니다."
        echo "연결 복구 명령어: rclone config reconnect $GDRIVE_REMOTE:"
        exit 1
    fi
    
    print_success "구글 드라이브 연결 정상"
}

# 프로젝트 디렉토리 확인
check_project_directory() {
    print_status "$BLUE" "📁 프로젝트 디렉토리 확인 중..."
    
    if [ ! -d "$PROJECT_PATH" ]; then
        print_error "프로젝트 디렉토리를 찾을 수 없습니다: $PROJECT_PATH"
        exit 1
    fi
    
    local file_count=$(find "$PROJECT_PATH" -type f | wc -l)
    local dir_size=$(du -sh "$PROJECT_PATH" | cut -f1)
    
    print_success "프로젝트 디렉토리 확인: $file_count개 파일, $dir_size 크기"
}

# 백업 실행
perform_backup() {
    print_status "$BLUE" "🔄 백업 시작..."
    
    local start_time=$(date +%s)
    
    # rclone sync 실행
    local rclone_output=$(rclone sync "$PROJECT_PATH" "$GDRIVE_REMOTE:$BACKUP_FOLDER" \
        --exclude "node_modules/**" \
        --exclude "*.log" \
        --exclude ".git/**" \
        --exclude "storage/temp/**" \
        --exclude "storage/logs/**" \
        --exclude "**.sqlite-wal" \
        --exclude "**.sqlite-shm" \
        --exclude ".env" \
        --progress \
        --stats 1s 2>&1)
    
    local rclone_exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 결과 처리
    if [ $rclone_exit_code -eq 0 ]; then
        print_success "백업 완료! (소요시간: ${duration}초)"
        log_message "SUCCESS" "백업 완료 - 소요시간: ${duration}초"
        
        # 백업 결과 통계
        show_backup_stats
    else
        print_error "백업 실패 (종료코드: $rclone_exit_code)"
        log_message "ERROR" "백업 실패 - rclone 출력: $rclone_output"
        echo "$rclone_output"
        exit 1
    fi
}

# 백업 통계 표시
show_backup_stats() {
    print_status "$BLUE" "📊 백업 통계 조회 중..."
    
    # 구글 드라이브의 백업 폴더 정보
    local backup_info=$(rclone size "$GDRIVE_REMOTE:$BACKUP_FOLDER" 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo "📈 백업 폴더 통계:"
        echo "$backup_info"
        
        # 파일 목록 (최상위만)
        echo
        echo "📂 백업된 폴더 목록:"
        rclone lsd "$GDRIVE_REMOTE:$BACKUP_FOLDER" 2>/dev/null | head -10
        
        echo
        echo "📄 백업된 파일 목록 (최근 10개):"
        rclone ls "$GDRIVE_REMOTE:$BACKUP_FOLDER" 2>/dev/null | head -10
    else
        print_warning "백업 통계를 가져올 수 없습니다."
    fi
}

# 제외된 항목 표시
show_excluded_items() {
    print_status "$BLUE" "🚫 백업에서 제외되는 항목들:"
    echo "   • node_modules/** (Node.js 의존성 - npm install로 복원 가능)"
    echo "   • *.log (로그 파일들)"
    echo "   • .git/** (Git 저장소 - 필요시 별도 백업)"
    echo "   • storage/temp/** (임시 파일들)"
    echo "   • storage/logs/** (로그 파일들)"
    echo "   • **.sqlite-wal, **.sqlite-shm (SQLite 임시 파일)"
    echo "   • .env (환경변수 파일 - 보안상 제외)"
    echo
}

# 사용법 표시
show_usage() {
    echo "사용법: $0 [옵션]"
    echo
    echo "옵션:"
    echo "  --dry-run    실제 백업 없이 변경사항만 확인"
    echo "  --stats      백업 통계만 표시"
    echo "  --help       이 도움말 표시"
    echo
    echo "예시:"
    echo "  $0              # 일반 백업 실행"
    echo "  $0 --dry-run    # 변경사항 미리보기"
    echo "  $0 --stats      # 현재 백업 상태 확인"
    echo
}

# 드라이 런 모드
perform_dry_run() {
    print_status "$BLUE" "🔍 드라이 런 모드: 변경사항 확인 중..."
    
    rclone sync "$PROJECT_PATH" "$GDRIVE_REMOTE:$BACKUP_FOLDER" \
        --exclude "node_modules/**" \
        --exclude "*.log" \
        --exclude ".git/**" \
        --exclude "storage/temp/**" \
        --exclude "storage/logs/**" \
        --exclude "**.sqlite-wal" \
        --exclude "**.sqlite-shm" \
        --exclude ".env" \
        --dry-run \
        --verbose
    
    print_warning "위는 미리보기입니다. 실제 백업을 하려면 --dry-run 없이 실행하세요."
}

# 메인 실행 함수
main() {
    local mode="backup"
    
    # 명령행 인수 처리
    case "${1:-}" in
        --help|-h)
            show_usage
            exit 0
            ;;
        --dry-run)
            mode="dry-run"
            ;;
        --stats)
            mode="stats"
            ;;
        *)
            if [ -n "${1:-}" ]; then
                print_error "알 수 없는 옵션: $1"
                show_usage
                exit 1
            fi
            ;;
    esac
    
    # 헤더 출력
    print_header
    
    # 기본 검사들
    if [ "$mode" != "stats" ]; then
        check_rclone
        check_gdrive_connection
        check_project_directory
        show_excluded_items
    fi
    
    # 모드별 실행
    case "$mode" in
        "backup")
            perform_backup
            ;;
        "dry-run")
            perform_dry_run
            ;;
        "stats")
            check_rclone
            check_gdrive_connection
            show_backup_stats
            ;;
    esac
    
    echo
    print_success "스크립트 실행 완료!"
    echo "================================================================"
}

# 스크립트 실행
main "$@"
