#!/bin/bash
# Korean Stock Alert - Installation Script
# 필요한 Python 패키지를 설치합니다.

echo "🚀 Korean Stock Alert 스킬 설치를 시작합니다..."

# Python 버전 확인
echo "📋 Python 버전 확인 중..."
python_version=$(python3 --version 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ $python_version 감지됨"
else
    echo "❌ Python3가 설치되어 있지 않습니다. Python3를 먼저 설치해주세요."
    exit 1
fi

# pip 업그레이드
echo "⬆️  pip 업그레이드 중..."
python3 -m pip install --upgrade pip

# 필요한 패키지 설치
echo "📦 필요한 패키지 설치 중..."

packages=(
    "requests>=2.25.0"
    "beautifulsoup4>=4.9.0"
    "lxml>=4.6.0"
)

for package in "${packages[@]}"; do
    echo "   📥 $package 설치 중..."
    python3 -m pip install "$package"
    if [ $? -eq 0 ]; then
        echo "   ✅ $package 설치 완료"
    else
        echo "   ❌ $package 설치 실패"
        exit 1
    fi
done

# 스크립트 실행 권한 부여
echo "🔐 실행 권한 설정 중..."
chmod +x "$(dirname "$0")/stock.py"

# 설치 테스트
echo "🧪 설치 테스트 중..."
python3 "$(dirname "$0")/stock.py" --market-summary > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ 테스트 성공! 스킬이 정상적으로 설치되었습니다."
else
    echo "⚠️  테스트에서 일부 오류가 발생했지만 설치는 완료되었습니다."
    echo "   네트워크 연결을 확인하고 다시 시도해보세요."
fi

echo ""
echo "🎉 Korean Stock Alert 스킬 설치가 완료되었습니다!"
echo ""
echo "사용법:"
echo "  python3 $(dirname "$0")/stock.py --code 005930          # 삼성전자 조회"
echo "  python3 $(dirname "$0")/stock.py --name '네이버'        # 종목명으로 조회"
echo "  python3 $(dirname "$0")/stock.py --market-summary      # 시장 요약"
echo "  python3 $(dirname "$0")/stock.py --top-stocks kospi    # KOSPI 상위종목"
echo ""
echo "📖 자세한 사용법은 SKILL.md 파일을 참고하세요."