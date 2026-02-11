#!/usr/bin/env python3
"""
IPRoyal 프록시 테스트 스크립트
"""
import os
import sys
import requests
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv('.env.local')

def test_proxy():
    """프록시 연결 테스트"""
    host = os.getenv('PROXY_HOST', 'geo.iproyal.com')
    port = os.getenv('PROXY_PORT', '12321')
    username = os.getenv('PROXY_USER', '')
    password = os.getenv('PROXY_PASS', '')
    
    if not username or not password:
        print("❌ PROXY_USER, PROXY_PASS 환경변수 필요")
        return False
    
    print(f"📍 프록시 테스트")
    print(f"   Host: {host}:{port}")
    print(f"   User: {username[:5]}***")
    print(f"   Pass: {password[:10]}***")
    
    # 프록시 URL 형식들
    proxy_formats = [
        # 형식 1: http://user:pass@host:port
        f"http://{username}:{password}@{host}:{port}",
        # 형식 2: 언더스코어 없는 경우
        f"http://{username}:{password.replace('_country-kr', '')}@{host}:{port}",
    ]
    
    for i, proxy_url in enumerate(proxy_formats):
        print(f"\n🔍 테스트 {i+1}: {proxy_url[:50]}...")
        
        proxies = {
            'http': proxy_url,
            'https': proxy_url,
        }
        
        try:
            response = requests.get(
                'https://httpbin.org/ip',
                proxies=proxies,
                timeout=15,
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"   ✅ 성공! IP: {data.get('origin', 'unknown')}")
                return True
            else:
                print(f"   ❌ 상태 코드: {response.status_code}")
                
        except requests.exceptions.ProxyError as e:
            print(f"   ❌ 프록시 오류: {e}")
        except requests.exceptions.Timeout:
            print(f"   ❌ 타임아웃")
        except Exception as e:
            print(f"   ❌ 오류: {e}")
    
    print("\n⚠️ 모든 프록시 형식 실패")
    print("\n💡 확인 사항:")
    print("   1. IPRoyal 대시보드에서 정확한 인증 정보 확인")
    print("   2. 프록시 형식: HOST:PORT:USERNAME:PASSWORD")
    print("   3. 한국 타겟팅: password_country-kr 또는 대시보드 설정")
    return False


def test_capsolver():
    """CapSolver 연결 테스트"""
    api_key = os.getenv('CAPSOLVER_API_KEY', '')
    
    if not api_key:
        print("❌ CAPSOLVER_API_KEY 환경변수 필요")
        return False
    
    print(f"\n📍 CapSolver 테스트")
    print(f"   Key: {api_key[:15]}***")
    
    try:
        response = requests.post(
            'https://api.capsolver.com/getBalance',
            json={'clientKey': api_key},
            timeout=10,
        )
        
        data = response.json()
        
        if data.get('errorId') == 0:
            balance = data.get('balance', 0)
            print(f"   ✅ 연결 성공! 잔액: ${balance}")
            return True
        else:
            print(f"   ❌ 오류: {data.get('errorDescription', data)}")
            return False
            
    except Exception as e:
        print(f"   ❌ 오류: {e}")
        return False


if __name__ == '__main__':
    print("=" * 50)
    print("🔧 BTS 티켓팅 인프라 테스트")
    print("=" * 50)
    
    proxy_ok = test_proxy()
    capsolver_ok = test_capsolver()
    
    print("\n" + "=" * 50)
    print("📊 결과 요약")
    print("=" * 50)
    print(f"   프록시: {'✅ 정상' if proxy_ok else '❌ 실패'}")
    print(f"   CapSolver: {'✅ 정상' if capsolver_ok else '❌ 실패'}")
    
    if proxy_ok and capsolver_ok:
        print("\n🎉 모든 테스트 통과!")
        sys.exit(0)
    else:
        print("\n⚠️ 일부 테스트 실패 - 위 로그 확인")
        sys.exit(1)
