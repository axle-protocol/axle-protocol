#!/usr/bin/env python3
"""
Korean Crypto Tracker
한국 암호화폐 거래소 실시간 추적 도구

업비트, 빗썸의 실시간 시세와 김치 프리미엄을 추적합니다.
"""

import requests
import json
import argparse
import time
import datetime
from typing import Dict, List, Optional, Tuple
from tabulate import tabulate
from colorama import init, Fore, Style, Back
import sys
import os

# 컬러 출력 초기화
init(autoreset=True)

class KoreanCryptoTracker:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Korean-Crypto-Tracker/1.0'
        })
        
        # 주요 암호화폐 심볼 매핑 (실제 존재하는 마켓만)
        self.symbols = {
            'BTC': {'upbit': 'KRW-BTC', 'bithumb': 'BTC', 'binance': 'BTCUSDT'},
            'ETH': {'upbit': 'KRW-ETH', 'bithumb': 'ETH', 'binance': 'ETHUSDT'},
            'XRP': {'upbit': 'KRW-XRP', 'bithumb': 'XRP', 'binance': 'XRPUSDT'},
            'ADA': {'upbit': 'KRW-ADA', 'bithumb': 'ADA', 'binance': 'ADAUSDT'},
            'DOT': {'upbit': 'KRW-DOT', 'bithumb': 'DOT', 'binance': 'DOTUSDT'},
            'LINK': {'upbit': 'KRW-LINK', 'bithumb': 'LINK', 'binance': 'LINKUSDT'},
            'SOL': {'upbit': 'KRW-SOL', 'bithumb': 'SOL', 'binance': 'SOLUSDT'},
            'DOGE': {'upbit': 'KRW-DOGE', 'bithumb': 'DOGE', 'binance': 'DOGEUSDT'},
        }
        
        # 현재 환율 (USD/KRW)
        self.usd_krw_rate = self.get_exchange_rate()
    
    def get_exchange_rate(self) -> float:
        """USD/KRW 환율 조회"""
        try:
            response = self.session.get(
                'https://api.exchangerate-api.com/v4/latest/USD',
                timeout=10
            )
            data = response.json()
            return data['rates']['KRW']
        except Exception as e:
            print(f"⚠️  환율 조회 실패: {e}")
            return 1330.0  # 기본값
    
    def get_upbit_prices(self, markets: List[str] = None) -> Dict:
        """업비트 시세 조회"""
        try:
            if markets is None:
                markets = [self.symbols[symbol]['upbit'] for symbol in self.symbols.keys()]
            
            market_param = ','.join(markets)
            url = f'https://api.upbit.com/v1/ticker?markets={market_param}'
            
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            result = {}
            
            for item in data:
                market = item['market']
                symbol = market.split('-')[1]
                result[symbol] = {
                    'exchange': 'upbit',
                    'symbol': symbol,
                    'price': item['trade_price'],
                    'change_rate': item['signed_change_rate'] * 100,
                    'volume_24h': item['acc_trade_volume_24h'],
                    'trade_value_24h': item['acc_trade_price_24h'],
                    'high_24h': item['high_price'],
                    'low_24h': item['low_price'],
                    'timestamp': item['timestamp'] / 1000
                }
            
            return result
            
        except Exception as e:
            print(f"❌ 업비트 API 오류: {e}")
            return {}
    
    def get_bithumb_prices(self) -> Dict:
        """빗썸 시세 조회"""
        try:
            url = 'https://api.bithumb.com/public/ticker/ALL_KRW'
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            if data['status'] != '0000':
                raise Exception(f"Bithumb API Error: {data['status']}")
            
            result = {}
            for symbol, price_data in data['data'].items():
                # 'date' 키는 전체 응답의 타임스탬프이므로 건너뛰기
                if symbol == 'date' or not isinstance(price_data, dict):
                    continue
                
                if symbol in [s for s in self.symbols.keys()]:
                    try:
                        result[symbol] = {
                            'exchange': 'bithumb',
                            'symbol': symbol,
                            'price': float(price_data['closing_price']),
                            'change_rate': float(price_data['fluctate_rate_24H']),
                            'volume_24h': float(price_data['units_traded_24H']),
                            'trade_value_24h': float(price_data['acc_trade_value_24H']),
                            'high_24h': float(price_data['max_price']),
                            'low_24h': float(price_data['min_price']),
                            'timestamp': float(data['data']['date']) / 1000
                        }
                    except (KeyError, ValueError) as e:
                        print(f"⚠️  빗썸 {symbol} 파싱 오류: {e}")
                        continue
            
            return result
            
        except Exception as e:
            print(f"❌ 빗썸 API 오류: {e}")
            return {}
    
    def get_binance_prices(self, symbols: List[str] = None) -> Dict:
        """바이낸스 시세 조회 (김치프리미엄 계산용)"""
        try:
            result = {}
            
            if symbols is None:
                symbols = list(self.symbols.keys())
            
            for symbol in symbols:
                if symbol not in self.symbols:
                    continue
                    
                binance_symbol = self.symbols[symbol]['binance']
                url = f'https://api.binance.com/api/v3/ticker/24hr?symbol={binance_symbol}'
                
                response = self.session.get(url, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                result[symbol] = {
                    'exchange': 'binance',
                    'symbol': symbol,
                    'price': float(data['lastPrice']),
                    'change_rate': float(data['priceChangePercent']),
                    'volume_24h': float(data['volume']),
                    'high_24h': float(data['highPrice']),
                    'low_24h': float(data['lowPrice']),
                    'timestamp': data['closeTime'] / 1000
                }
            
            return result
            
        except Exception as e:
            print(f"❌ 바이낸스 API 오류: {e}")
            return {}
    
    def calculate_kimchi_premium(self, korean_price: float, global_price: float) -> float:
        """김치 프리미엄 계산"""
        korean_price_usd = korean_price / self.usd_krw_rate
        premium = ((korean_price_usd - global_price) / global_price) * 100
        return premium
    
    def get_all_prices(self) -> Dict:
        """모든 거래소 시세 조회"""
        print("📡 실시간 시세 조회 중...")
        
        upbit_data = self.get_upbit_prices()
        bithumb_data = self.get_bithumb_prices()
        binance_data = self.get_binance_prices()
        
        return {
            'upbit': upbit_data,
            'bithumb': bithumb_data,
            'binance': binance_data,
            'usd_krw': self.usd_krw_rate
        }
    
    def display_prices(self, data: Dict, format_type: str = 'table'):
        """시세 정보 출력"""
        if format_type == 'json':
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return
        
        print(f"\n🏦 {Fore.YELLOW}한국 암호화폐 거래소 실시간 시세{Style.RESET_ALL}")
        print(f"💱 현재 환율: {self.usd_krw_rate:,.2f} KRW/USD")
        print(f"⏰ 업데이트: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        
        # 업비트 테이블
        if data['upbit']:
            upbit_table = []
            for symbol, info in data['upbit'].items():
                change_color = Fore.RED if info['change_rate'] < 0 else Fore.GREEN
                upbit_table.append([
                    symbol,
                    f"{info['price']:,.0f}",
                    f"{change_color}{info['change_rate']:+.2f}%{Style.RESET_ALL}",
                    f"{info['volume_24h']:,.2f}",
                    f"{info['trade_value_24h']/1e8:.1f}억"
                ])
            
            print(f"🔵 {Fore.BLUE}업비트 (Upbit){Style.RESET_ALL}")
            print(tabulate(upbit_table, 
                headers=['코인', '현재가(KRW)', '24h 변동률', '24h 거래량', '24h 거래대금'],
                tablefmt='grid'))
            print()
        
        # 빗썸 테이블
        if data['bithumb']:
            bithumb_table = []
            for symbol, info in data['bithumb'].items():
                change_color = Fore.RED if info['change_rate'] < 0 else Fore.GREEN
                bithumb_table.append([
                    symbol,
                    f"{info['price']:,.0f}",
                    f"{change_color}{info['change_rate']:+.2f}%{Style.RESET_ALL}",
                    f"{info['volume_24h']:,.2f}",
                    f"{info['trade_value_24h']/1e8:.1f}억"
                ])
            
            print(f"🟡 {Fore.YELLOW}빗썸 (Bithumb){Style.RESET_ALL}")
            print(tabulate(bithumb_table, 
                headers=['코인', '현재가(KRW)', '24h 변동률', '24h 거래량', '24h 거래대금'],
                tablefmt='grid'))
            print()
    
    def display_kimchi_premium(self, data: Dict, threshold: float = None):
        """김치 프리미엄 출력"""
        print(f"\n🌶️  {Fore.RED}김치 프리미엄 현황{Style.RESET_ALL}")
        print(f"💱 환율: {self.usd_krw_rate:,.2f} KRW/USD")
        print(f"⏰ 업데이트: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        
        premium_table = []
        
        for symbol in self.symbols.keys():
            upbit_price = data['upbit'].get(symbol, {}).get('price', 0)
            bithumb_price = data['bithumb'].get(symbol, {}).get('price', 0)
            binance_price = data['binance'].get(symbol, {}).get('price', 0)
            
            if binance_price == 0:
                continue
            
            upbit_premium = self.calculate_kimchi_premium(upbit_price, binance_price) if upbit_price > 0 else 0
            bithumb_premium = self.calculate_kimchi_premium(bithumb_price, binance_price) if bithumb_price > 0 else 0
            
            # 임계값 필터링
            if threshold is not None:
                if abs(upbit_premium) < threshold and abs(bithumb_premium) < threshold:
                    continue
            
            # 컬러 설정
            upbit_color = Fore.GREEN if upbit_premium > 0 else Fore.RED
            bithumb_color = Fore.GREEN if bithumb_premium > 0 else Fore.RED
            
            premium_table.append([
                symbol,
                f"${binance_price:,.2f}",
                f"₩{upbit_price:,.0f}" if upbit_price > 0 else "N/A",
                f"{upbit_color}{upbit_premium:+.2f}%{Style.RESET_ALL}" if upbit_price > 0 else "N/A",
                f"₩{bithumb_price:,.0f}" if bithumb_price > 0 else "N/A",
                f"{bithumb_color}{bithumb_premium:+.2f}%{Style.RESET_ALL}" if bithumb_price > 0 else "N/A"
            ])
        
        print(tabulate(premium_table,
            headers=['코인', '바이낸스(USD)', '업비트(KRW)', '업비트 프리미엄', '빗썸(KRW)', '빗썸 프리미엄'],
            tablefmt='grid'))
        
        # 요약 통계
        premiums = []
        for row in premium_table:
            if "N/A" not in row[3]:
                premiums.append(float(row[3].split('%')[0].replace('+', '').replace(Fore.GREEN, '').replace(Fore.RED, '').replace(Style.RESET_ALL, '')))
            if "N/A" not in row[5]:
                premiums.append(float(row[5].split('%')[0].replace('+', '').replace(Fore.GREEN, '').replace(Fore.RED, '').replace(Style.RESET_ALL, '')))
        
        if premiums:
            avg_premium = sum(premiums) / len(premiums)
            max_premium = max(premiums)
            min_premium = min(premiums)
            
            print(f"\n📊 김치 프리미엄 요약:")
            print(f"  • 평균: {avg_premium:+.2f}%")
            print(f"  • 최대: {max_premium:+.2f}%")
            print(f"  • 최소: {min_premium:+.2f}%")
    
    def detect_volume_surge(self, data: Dict, multiplier: float = 2.0):
        """거래량 급등 종목 탐지"""
        print(f"\n📈 {Fore.CYAN}거래량 급등 종목 탐지{Style.RESET_ALL}")
        print(f"🔍 기준: 평균 대비 {multiplier}배 이상 거래량\n")
        
        surge_table = []
        
        # 업비트 거래량 분석
        if data['upbit']:
            volumes = [info['volume_24h'] for info in data['upbit'].values()]
            avg_volume = sum(volumes) / len(volumes) if volumes else 0
            
            for symbol, info in data['upbit'].items():
                volume_ratio = info['volume_24h'] / avg_volume if avg_volume > 0 else 0
                
                if volume_ratio >= multiplier:
                    surge_table.append([
                        'Upbit',
                        symbol,
                        f"{info['price']:,.0f}",
                        f"{info['change_rate']:+.2f}%",
                        f"{info['volume_24h']:,.0f}",
                        f"{volume_ratio:.1f}x"
                    ])
        
        # 빗썸 거래량 분석
        if data['bithumb']:
            volumes = [info['volume_24h'] for info in data['bithumb'].values()]
            avg_volume = sum(volumes) / len(volumes) if volumes else 0
            
            for symbol, info in data['bithumb'].items():
                volume_ratio = info['volume_24h'] / avg_volume if avg_volume > 0 else 0
                
                if volume_ratio >= multiplier:
                    surge_table.append([
                        'Bithumb',
                        symbol,
                        f"{info['price']:,.0f}",
                        f"{info['change_rate']:+.2f}%",
                        f"{info['volume_24h']:,.0f}",
                        f"{volume_ratio:.1f}x"
                    ])
        
        if surge_table:
            print(tabulate(surge_table,
                headers=['거래소', '코인', '현재가', '24h 변동률', '24h 거래량', '평균 대비'],
                tablefmt='grid'))
        else:
            print("⚠️  현재 거래량 급등 종목이 없습니다.")
    
    def market_summary(self, data: Dict):
        """시장 요약"""
        print(f"\n📋 {Fore.MAGENTA}한국 암호화폐 시장 요약{Style.RESET_ALL}")
        print(f"📅 {datetime.datetime.now().strftime('%Y년 %m월 %d일 %H시 %M분')}")
        print(f"💱 USD/KRW: {self.usd_krw_rate:,.2f}")
        print("-" * 60)
        
        # 상승/하락 종목 수
        upbit_up = sum(1 for info in data['upbit'].values() if info['change_rate'] > 0)
        upbit_down = sum(1 for info in data['upbit'].values() if info['change_rate'] < 0)
        
        print(f"\n🔵 업비트:")
        print(f"  상승: {upbit_up}개  📈")
        print(f"  하락: {upbit_down}개  📉")
        
        if data['bithumb']:
            bithumb_up = sum(1 for info in data['bithumb'].values() if info['change_rate'] > 0)
            bithumb_down = sum(1 for info in data['bithumb'].values() if info['change_rate'] < 0)
            
            print(f"\n🟡 빗썸:")
            print(f"  상승: {bithumb_up}개  📈")
            print(f"  하락: {bithumb_down}개  📉")
        
        # 상위 상승 종목
        all_coins = list(data['upbit'].items()) + list(data['bithumb'].items())
        top_gainers = sorted(all_coins, key=lambda x: x[1]['change_rate'], reverse=True)[:3]
        
        print(f"\n🏆 상위 상승 종목:")
        for i, (symbol, info) in enumerate(top_gainers, 1):
            print(f"  {i}. {symbol} ({info['exchange']}): {info['change_rate']:+.2f}%")
        
        # 상위 하락 종목
        top_losers = sorted(all_coins, key=lambda x: x[1]['change_rate'])[:3]
        
        print(f"\n📉 상위 하락 종목:")
        for i, (symbol, info) in enumerate(top_losers, 1):
            print(f"  {i}. {symbol} ({info['exchange']}): {info['change_rate']:+.2f}%")
        
        # 김치 프리미엄 요약
        premiums = []
        for symbol in self.symbols.keys():
            upbit_price = data['upbit'].get(symbol, {}).get('price', 0)
            binance_price = data['binance'].get(symbol, {}).get('price', 0)
            
            if upbit_price > 0 and binance_price > 0:
                premium = self.calculate_kimchi_premium(upbit_price, binance_price)
                premiums.append(premium)
        
        if premiums:
            avg_premium = sum(premiums) / len(premiums)
            print(f"\n🌶️  평균 김치프리미엄: {avg_premium:+.2f}%")


def main():
    parser = argparse.ArgumentParser(description='한국 암호화폐 거래소 실시간 추적 도구')
    parser.add_argument('--prices', action='store_true', help='실시간 시세 조회')
    parser.add_argument('--kimchi-premium', action='store_true', help='김치 프리미엄 계산')
    parser.add_argument('--volume-surge', action='store_true', help='거래량 급등 종목 탐지')
    parser.add_argument('--market-summary', action='store_true', help='일일 시장 요약')
    parser.add_argument('--coin', type=str, help='특정 코인 조회 (예: BTC)')
    parser.add_argument('--threshold', type=float, help='김치 프리미엄 임계값 (퍼센트)')
    parser.add_argument('--format', choices=['table', 'json'], default='table', help='출력 형식')
    parser.add_argument('--all', action='store_true', help='모든 정보 출력')
    
    args = parser.parse_args()
    
    if len(sys.argv) == 1:
        parser.print_help()
        return
    
    tracker = KoreanCryptoTracker()
    
    try:
        # 데이터 수집
        data = tracker.get_all_prices()
        
        if args.prices or args.all:
            tracker.display_prices(data, args.format)
        
        if args.kimchi_premium or args.all:
            tracker.display_kimchi_premium(data, args.threshold)
        
        if args.volume_surge or args.all:
            tracker.detect_volume_surge(data)
        
        if args.market_summary or args.all:
            tracker.market_summary(data)
        
        if args.coin:
            symbol = args.coin.upper()
            if symbol in tracker.symbols:
                print(f"\n🔍 {symbol} 상세 정보:")
                for exchange in ['upbit', 'bithumb', 'binance']:
                    if symbol in data.get(exchange, {}):
                        info = data[exchange][symbol]
                        print(f"  {exchange}: {info['price']:,.2f} ({info['change_rate']:+.2f}%)")
            else:
                print(f"❌ 지원하지 않는 코인: {symbol}")
                print(f"지원 코인: {', '.join(tracker.symbols.keys())}")
    
    except KeyboardInterrupt:
        print(f"\n\n{Fore.YELLOW}사용자 중단{Style.RESET_ALL}")
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()