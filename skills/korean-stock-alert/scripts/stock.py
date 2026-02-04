#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Korean Stock Alert - Real-time Stock Price Monitor
네이버 금융에서 실시간 주식 데이터를 가져오는 스크립트

Usage:
    python stock.py --code 005930
    python stock.py --name "삼성전자"
    python stock.py --portfolio
    python stock.py --market-summary
"""

import requests
import json
import sys
import argparse
import re
from datetime import datetime
from bs4 import BeautifulSoup
from urllib.parse import quote

class KoreanStockMonitor:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        self.base_url = 'https://finance.naver.com'
        
    def search_stock(self, query):
        """종목명으로 종목코드 검색"""
        try:
            search_url = f"{self.base_url}/search/searchList.naver"
            params = {
                'query': query,
                'target': 'stock'
            }
            
            response = self.session.get(search_url, params=params)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            results = []
            items = soup.select('.result_item')
            
            for item in items:
                name_elem = item.select_one('.item_name')
                code_elem = item.select_one('.code')
                
                if name_elem and code_elem:
                    name = name_elem.get_text(strip=True)
                    code = code_elem.get_text(strip=True)
                    results.append({
                        'name': name,
                        'code': code
                    })
            
            return results
        except Exception as e:
            return [{'error': f'검색 실패: {str(e)}'}]
    
    def get_stock_price(self, code):
        """종목코드로 실시간 주가 정보 조회"""
        try:
            # 네이버 금융 종목 페이지
            url = f"{self.base_url}/item/main.naver"
            params = {'code': code}
            
            response = self.session.get(url, params=params)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 종목명
            name_elem = soup.select_one('.wrap_company h2 a')
            name = name_elem.get_text(strip=True) if name_elem else "N/A"
            
            # 현재가
            price_elem = soup.select_one('.no_today .blind')
            current_price = price_elem.get_text(strip=True) if price_elem else "N/A"
            
            # 등락률 및 등락액
            change_elem = soup.select_one('.no_exday .blind')
            change = change_elem.get_text(strip=True) if change_elem else "N/A"
            
            # 등락률 (%)
            rate_elem = soup.select_one('.no_exday .blind')
            if rate_elem and rate_elem.find_next('span'):
                rate = rate_elem.find_next('span').get_text(strip=True)
            else:
                rate = "N/A"
            
            # 거래량
            volume_elem = soup.select_one('.first .blind')
            volume = volume_elem.get_text(strip=True) if volume_elem else "N/A"
            
            # 시가총액
            market_cap_elem = soup.select_one('.first')
            if market_cap_elem:
                siblings = market_cap_elem.find_next_siblings('em')
                market_cap = siblings[0].get_text(strip=True) if siblings else "N/A"
            else:
                market_cap = "N/A"
                
            # 52주 최고/최저
            high_low = self._get_52week_high_low(soup)
            
            return {
                'code': code,
                'name': name,
                'current_price': current_price,
                'change': change,
                'change_rate': rate,
                'volume': volume,
                'market_cap': market_cap,
                'high_52w': high_low.get('high', 'N/A'),
                'low_52w': high_low.get('low', 'N/A'),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'market': self._determine_market(code)
            }
            
        except Exception as e:
            return {
                'code': code,
                'error': f'데이터 조회 실패: {str(e)}',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
    
    def _get_52week_high_low(self, soup):
        """52주 최고/최저 가격 추출"""
        try:
            high_low_section = soup.select('.description .blind')
            high = "N/A"
            low = "N/A"
            
            for elem in high_low_section:
                text = elem.get_text()
                if "최고" in text:
                    high = text.replace("최고", "").strip()
                elif "최저" in text:
                    low = text.replace("최저", "").strip()
                    
            return {'high': high, 'low': low}
        except:
            return {'high': 'N/A', 'low': 'N/A'}
    
    def _determine_market(self, code):
        """종목코드로 시장 구분"""
        try:
            code_int = int(code)
            if code_int < 100000:
                return "KOSPI"
            else:
                return "KOSDAQ"
        except:
            return "UNKNOWN"
    
    def get_market_summary(self):
        """시장 지수 및 요약 정보"""
        try:
            url = f"{self.base_url}/sise/"
            response = self.session.get(url)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # KOSPI 지수
            kospi_elem = soup.select_one('.kospi_area .num')
            kospi_price = kospi_elem.get_text(strip=True) if kospi_elem else "N/A"
            
            kospi_change_elem = soup.select_one('.kospi_area .change_rate')
            kospi_change = kospi_change_elem.get_text(strip=True) if kospi_change_elem else "N/A"
            
            # KOSDAQ 지수
            kosdaq_elem = soup.select_one('.kosdaq_area .num')
            kosdaq_price = kosdaq_elem.get_text(strip=True) if kosdaq_elem else "N/A"
            
            kosdaq_change_elem = soup.select_one('.kosdaq_area .change_rate')
            kosdaq_change = kosdaq_change_elem.get_text(strip=True) if kosdaq_change_elem else "N/A"
            
            return {
                'kospi': {
                    'index': kospi_price,
                    'change': kospi_change
                },
                'kosdaq': {
                    'index': kosdaq_price,
                    'change': kosdaq_change
                },
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
            
        except Exception as e:
            return {
                'error': f'시장 요약 조회 실패: {str(e)}',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
    
    def get_top_stocks(self, market='kospi', sort_type='volume'):
        """상위 종목 조회 (거래량, 상승률, 하락률 기준)"""
        try:
            if market.lower() == 'kospi':
                url = f"{self.base_url}/sise/sise_market_sum.naver?sosok=0"
            else:
                url = f"{self.base_url}/sise/sise_market_sum.naver?sosok=1"
                
            response = self.session.get(url)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            stocks = []
            rows = soup.select('table.type_2 tr')[2:]  # 헤더 제외
            
            for row in rows[:10]:  # 상위 10개만
                cells = row.select('td')
                if len(cells) >= 6:
                    name = cells[1].get_text(strip=True)
                    price = cells[2].get_text(strip=True)
                    change = cells[3].get_text(strip=True)
                    change_rate = cells[4].get_text(strip=True)
                    volume = cells[5].get_text(strip=True)
                    
                    if name and name != "N/A":
                        stocks.append({
                            'name': name,
                            'price': price,
                            'change': change,
                            'change_rate': change_rate,
                            'volume': volume
                        })
            
            return {
                'market': market.upper(),
                'stocks': stocks,
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
            
        except Exception as e:
            return {
                'error': f'{market} 상위 종목 조회 실패: {str(e)}',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }

def main():
    parser = argparse.ArgumentParser(description='Korean Stock Monitor')
    parser.add_argument('--code', help='종목코드로 조회')
    parser.add_argument('--name', help='종목명으로 검색 후 조회')
    parser.add_argument('--search', help='종목 검색만 수행')
    parser.add_argument('--market-summary', action='store_true', help='시장 지수 요약')
    parser.add_argument('--top-stocks', help='상위 종목 조회 (kospi/kosdaq)')
    parser.add_argument('--portfolio', help='포트폴리오 파일 경로')
    
    args = parser.parse_args()
    monitor = KoreanStockMonitor()
    
    result = {}
    
    if args.code:
        # 종목코드로 직접 조회
        result = monitor.get_stock_price(args.code)
        
    elif args.name:
        # 종목명으로 검색 후 첫 번째 결과 조회
        search_results = monitor.search_stock(args.name)
        if search_results and 'code' in search_results[0]:
            code = search_results[0]['code']
            result = monitor.get_stock_price(code)
        else:
            result = {'error': f'종목 "{args.name}"을 찾을 수 없습니다', 'search_results': search_results}
            
    elif args.search:
        # 검색만 수행
        result = {'search_results': monitor.search_stock(args.search)}
        
    elif args.market_summary:
        # 시장 요약
        result = monitor.get_market_summary()
        
    elif args.top_stocks:
        # 상위 종목
        result = monitor.get_top_stocks(args.top_stocks)
        
    elif args.portfolio:
        # 포트폴리오 조회 (구현 예정)
        result = {'error': '포트폴리오 기능은 추후 구현 예정입니다'}
        
    else:
        parser.print_help()
        return
    
    # JSON 형태로 출력
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()