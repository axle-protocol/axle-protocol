#!/bin/bash

# Korean Crypto Tracker - 의존성 설치 스크립트

echo "🚀 한국 암호화폐 추적기 설치 시작..."

# Python 버전 확인
python_version=$(python3 --version 2>&1)
echo "✅ Python 버전: $python_version"

# pip 업그레이드
echo "📦 pip 업그레이드..."
python3 -m pip install --upgrade pip

# 필수 패키지 설치
echo "📋 필수 패키지 설치 중..."

packages=(
    "requests>=2.25.0"
    "tabulate>=0.8.0"
    "colorama>=0.4.0"
    "python-dateutil>=2.8.0"
)

for package in "${packages[@]}"; do
    echo "  - $package 설치 중..."
    python3 -m pip install "$package"
done

echo "✅ 모든 패키지 설치 완료!"

# 설치 확인
echo "🔍 설치 확인 중..."
python3 -c "
import requests
import tabulate
import colorama
import json
import datetime
import argparse
from dateutil import parser
print('✅ 모든 패키지 정상 임포트 완료!')
"

echo "🎉 한국 암호화폐 추적기 설치 완료!"
echo ""
echo "사용법:"
echo "  python3 crypto.py --prices"
echo "  python3 crypto.py --kimchi-premium"
echo "  python3 crypto.py --market-summary"
echo ""
echo "자세한 사용법은 'python3 crypto.py --help' 참고"