#!/usr/bin/env python3
"""
BTS 티켓팅 - 셋업 확인 스크립트

사용법:
    python check_setup.py          # 전체 확인
    python check_setup.py --quick  # 빠른 확인 (API 호출 없음)
    python check_setup.py --proxy  # 프록시만 테스트
    python check_setup.py --captcha # 캡차 솔버만 테스트
"""

import os
import sys
import json
import argparse
from datetime import datetime

# 환경 변수 로드
def load_env(filepath: str = '.env.local'):
    if os.path.exists(filepath):
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"\'')

load_env()
load_env('../.env.local')


def check_capsolver_balance() -> dict:
    """CapSolver 잔액 확인"""
    try:
        import requests
    except ImportError:
        return {'error': 'requests 모듈 필요: pip install requests'}
    
    api_key = os.getenv('CAPSOLVER_API_KEY', '')
    if not api_key:
        return {'error': 'CAPSOLVER_API_KEY 환경변수 없음'}
    
    try:
        response = requests.post(
            'https://api.capsolver.com/getBalance',
            json={'clientKey': api_key},
            timeout=10
        )
        data = response.json()
        
        if data.get('errorId') == 0:
            balance = data.get('balance', 0)
            packages = data.get('packages', [])
            return {
                'success': True,
                'balance': balance,
                'packages': packages,
                'api_key_preview': f"{api_key[:10]}...{api_key[-4:]}"
            }
        else:
            return {
                'error': data.get('errorDescription', 'Unknown error'),
                'errorId': data.get('errorId')
            }
    except Exception as e:
        return {'error': str(e)}


def check_proxy() -> dict:
    """IPRoyal 프록시 테스트"""
    try:
        import requests
    except ImportError:
        return {'error': 'requests 모듈 필요'}
    
    host = os.getenv('PROXY_HOST', '')
    port = os.getenv('PROXY_PORT', '12321')
    user = os.getenv('PROXY_USER', '')
    password = os.getenv('PROXY_PASS', '')
    
    if not all([host, user, password]):
        return {'error': '프록시 환경변수 불완전 (PROXY_HOST, PROXY_USER, PROXY_PASS)'}
    
    proxy_url = f"http://{user}:{password}@{host}:{port}"
    
    try:
        # 프록시를 통해 IP 확인
        response = requests.get(
            'https://httpbin.org/ip',
            proxies={'http': proxy_url, 'https': proxy_url},
            timeout=15
        )
        data = response.json()
        proxy_ip = data.get('origin', 'Unknown')
        
        # IP 위치 확인
        geo_response = requests.get(
            f'https://ipapi.co/{proxy_ip}/json/',
            timeout=10
        )
        geo_data = geo_response.json()
        
        return {
            'success': True,
            'proxy_ip': proxy_ip,
            'country': geo_data.get('country_name', 'Unknown'),
            'country_code': geo_data.get('country_code', 'Unknown'),
            'city': geo_data.get('city', 'Unknown'),
            'isp': geo_data.get('org', 'Unknown'),
            'is_korea': geo_data.get('country_code') == 'KR',
        }
    except Exception as e:
        return {'error': str(e)}


def check_accounts() -> dict:
    """계정 설정 확인"""
    accounts = []
    
    for i in range(1, 6):
        user_id = os.getenv(f'INTERPARK_ID_{i}', '')
        user_pwd = os.getenv(f'INTERPARK_PWD_{i}', '')
        
        # 기본 계정도 확인
        if not user_id and i == 1:
            user_id = os.getenv('INTERPARK_ID', '')
            user_pwd = os.getenv('INTERPARK_PWD', '')
        
        accounts.append({
            'index': i,
            'configured': bool(user_id and user_pwd),
            'id_preview': f"{user_id[:5]}...{user_id[-5:]}" if len(user_id) > 10 else user_id[:3] + '***',
        })
    
    configured_count = sum(1 for a in accounts if a['configured'])
    
    return {
        'accounts': accounts,
        'configured_count': configured_count,
        'recommendation': '5개 권장' if configured_count < 5 else '✅ 충분',
    }


def check_concert_url() -> dict:
    """공연 URL 확인"""
    url = os.getenv('CONCERT_URL', '')
    
    if not url:
        return {'error': 'CONCERT_URL 환경변수 없음'}
    
    if 'XXXXXXX' in url:
        return {
            'error': 'CONCERT_URL에 실제 공연 ID를 설정하세요',
            'current': url
        }
    
    if not url.startswith('https://tickets.interpark.com/'):
        return {
            'warning': 'URL이 인터파크 형식이 아닙니다',
            'current': url
        }
    
    return {
        'success': True,
        'url': url,
        'concert_id': url.split('/')[-1] if '/' in url else 'Unknown'
    }


def print_result(title: str, result: dict, color: bool = True):
    """결과 출력"""
    print(f"\n{'='*50}")
    print(f"📋 {title}")
    print('='*50)
    
    if result.get('error'):
        print(f"❌ 에러: {result['error']}")
    elif result.get('warning'):
        print(f"⚠️ 경고: {result['warning']}")
    else:
        for key, value in result.items():
            if key in ['success', 'error', 'warning']:
                continue
            
            # 특수 포맷팅
            if isinstance(value, bool):
                value = '✅ Yes' if value else '❌ No'
            elif isinstance(value, float):
                value = f"${value:.2f}"
            elif isinstance(value, list):
                value = json.dumps(value, indent=2)
            
            print(f"  {key}: {value}")
    
    print()


def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 셋업 확인')
    parser.add_argument('--quick', action='store_true', help='빠른 확인 (API 호출 없음)')
    parser.add_argument('--proxy', action='store_true', help='프록시만 테스트')
    parser.add_argument('--captcha', action='store_true', help='캡차 솔버만 테스트')
    args = parser.parse_args()
    
    print("\n" + "🎫 BTS 티켓팅 셋업 확인".center(50))
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # 선택적 테스트
    if args.proxy:
        print_result("프록시 테스트", check_proxy())
        return
    
    if args.captcha:
        print_result("CapSolver 잔액", check_capsolver_balance())
        return
    
    # 전체 확인
    print_result("공연 URL", check_concert_url())
    print_result("계정 설정", check_accounts())
    
    if not args.quick:
        print_result("CapSolver 잔액", check_capsolver_balance())
        print_result("프록시 테스트", check_proxy())
    else:
        print("\n⏩ --quick 모드: API 테스트 생략")
    
    # 최종 요약
    print("\n" + "="*50)
    print("📊 최종 요약")
    print("="*50)
    
    url_ok = not check_concert_url().get('error')
    accounts = check_accounts()
    
    print(f"  공연 URL: {'✅' if url_ok else '❌'}")
    print(f"  계정 설정: {accounts['configured_count']}/5개 {'✅' if accounts['configured_count'] >= 3 else '⚠️'}")
    
    if not args.quick:
        capsolver = check_capsolver_balance()
        proxy = check_proxy()
        
        print(f"  CapSolver: {'✅ $' + str(capsolver.get('balance', 0)) if capsolver.get('success') else '❌'}")
        print(f"  프록시: {'✅ ' + ('한국 IP' if proxy.get('is_korea') else proxy.get('country', '')) if proxy.get('success') else '❌'}")
    
    print("\n")


if __name__ == '__main__':
    main()
