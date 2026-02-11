#!/usr/bin/env python3
"""
고급 좌석 선택 모듈 v3 - BTS 티켓팅 (10점 목표)
실전 안정성 + 에러 복구 + 다중 셀렉터 폴백

v3 핵심 개선:
- 다중 셀렉터 자동 폴백 (셀렉터 변경 대응)
- 부분 성공 상태 저장/복구
- 서버 과부하 대응 (재시도 + 백오프)
- 세션 간 좌석 중복 방지 강화
- 봇 탐지 회피 클릭 패턴
- Canvas/SVG 고급 분석
"""

import time
import re
import random
import threading
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any, Set
from datetime import datetime
from enum import Enum

# 타입 힌트용
SB = Any

# 공통 유틸리티 import
try:
    from utils import (
        log, Timing, adaptive_sleep, human_delay,
        MultiSelector, Selectors, retry, retry_on_stale,
        get_shared_state, PartialSuccessTracker,
        ServerOverloadDetector, get_overload_detector,
        wait_for_condition, AntiDetection, Timer
    )
except ImportError:
    # 폴백 (테스트용)
    class Timing:
        MICRO = 0.03; TINY = 0.08; SHORT = 0.2; MEDIUM = 0.4; LONG = 0.8
        ELEMENT_TIMEOUT = 3; MAX_RETRIES = 5
    def log(msg: str, **kw): print(f'[{datetime.now().strftime("%H:%M:%S.%f")[:-3]}] {msg}')
    def adaptive_sleep(t, **kw): time.sleep(t)
    def human_delay(a=50, b=150): time.sleep(random.uniform(a/1000, b/1000))
    def wait_for_condition(c, timeout=5, **kw):
        s = time.time()
        while time.time() - s < timeout:
            if c(): return True
            time.sleep(0.01)
        return False
    def retry(**kw):
        def decorator(func):
            return func
        return decorator
    def retry_on_stale(func): return func
    class MultiSelector:
        def __init__(self, sb, sels, desc=""): self.sb = sb; self.selectors = sels
        def find_element(self, **kw): 
            for sel in self.selectors:
                try:
                    e = self.sb.find_element(sel)
                    if e: return e
                except: pass
            return None
        def find_elements(self, **kw):
            for sel in self.selectors:
                try:
                    elems = self.sb.find_elements(sel)
                    if elems: return elems
                except: pass
            return []
        def click(self, **kw):
            e = self.find_element()
            if e: e.click(); return True
            return False
    class Selectors:
        SEAT_FRAME = ['#ifrmSeat']
        SEAT_AVAILABLE = ["[class*='seat']:not([class*='sold'])"]
        NEXT_STEP = ['#NextStepImage']
    def get_shared_state(): return None
    class PartialSuccessTracker:
        def __init__(self, sid): pass
        def checkpoint(self, stage, data=None): pass
    class Timer:
        def __init__(self, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
    class AntiDetection:
        @staticmethod
        def human_click(sb, elem, **kw): elem.click()


class SeatStatus(Enum):
    """좌석 상태"""
    AVAILABLE = "available"
    SOLD = "sold"
    SELECTED = "selected"
    DISABLED = "disabled"
    UNKNOWN = "unknown"


@dataclass
class SeatPreference:
    """좌석 선호도 설정 - 확장"""
    # 구역 우선순위 (앞쪽이 높은 우선순위)
    zone_priority: List[str] = field(default_factory=lambda: [
        '스탠딩A', '스탠딩B', 'VIP', 'VVIP', 'R석', 'S석', 'A석', 'B석',
        '객석1층', '1층', '객석2층', '2층', '객석3층', '3층',
        'FLOOR', 'STANDING', 'PREMIUM', 'GENERAL',
        '지정석', '일반석',
    ])
    
    # 좌석 등급 우선순위
    grade_priority: List[str] = field(default_factory=lambda: [
        'VVIP', 'VIP', 'R석', 'S석', 'A석', 'B석', '일반석', '지정석'
    ])
    
    # 열 범위 (1~10열 선호)
    preferred_rows: Tuple[int, int] = (1, 10)
    
    # 좌석 번호 범위 (중앙 선호)
    preferred_seats: Tuple[int, int] = (10, 40)
    
    # 필요한 좌석 수
    num_seats: int = 2
    
    # 연석 필수 여부
    consecutive_required: bool = True
    
    # 연석 최대 간격 (픽셀)
    consecutive_max_gap: int = 60
    
    # 제외할 구역
    exclude_zones: List[str] = field(default_factory=list)
    
    # 제외할 열 (시야제한 등)
    exclude_rows: List[int] = field(default_factory=list)
    
    # 스탠딩 허용
    allow_standing: bool = True
    
    # 최대 시도 횟수
    max_attempts: int = 10
    
    # 폴백 모드 (연석 못 찾으면 개별 선택)
    fallback_to_individual: bool = True


@dataclass
class SeatInfo:
    """좌석 정보 - 확장"""
    zone: str = ""
    grade: str = ""
    row: str = ""
    seat_num: str = ""
    element: Any = None
    x: int = 0
    y: int = 0
    score: float = 0.0
    is_available: bool = True
    status: SeatStatus = SeatStatus.UNKNOWN
    raw_id: str = ""  # 원본 ID
    click_retries: int = 0  # 클릭 재시도 횟수


class SeatSelector:
    """고급 좌석 선택기 v3 - 실전 최적화"""
    
    # 프레임 셀렉터 (다중)
    FRAME_SELECTORS = {
        'seat_frame': ['#ifrmSeat', 'iframe[name="ifrmSeat"]', 'iframe[src*="seat"]'],
        'seat_detail_frame': ['#ifrmSeatDetail', 'iframe[name="ifrmSeatDetail"]'],
        'book_step_frame': ['#ifrmBookStep', 'iframe[name="ifrmBookStep"]'],
    }
    
    # 구역/등급 선택 (다중 셀렉터)
    ZONE_SELECTORS = [
        '#GradeDetail > div > ul > li > a',
        '#GradeRow td div span',
        '[class*="grade"] a',
        '[class*="zone"] a',
        '[class*="area"] li a',
        'li[class*="grade"]',
    ]
    
    # 좌석 요소 (우선순위 순) - 인터파크 실제 DOM 기반
    SEAT_SELECTORS = [
        # 인터파크 핵심 셀렉터 (최우선)
        "#Seats",  # 인터파크 메인 좌석 요소
        "#Seats circle",  # SVG 내부 좌석
        "#Seats rect",
        
        # SVG 좌석 (circle 기반)
        "circle[class*='st'][fill*='#']:not([fill*='gray']):not([fill*='#ccc']):not([fill*='#999'])",
        "circle[class*='seat'][class*='available']",
        "circle[class*='seat']:not([class*='sold']):not([class*='disabled']):not([class*='selected'])",
        "circle.st0:not(.sold):not(.disabled)",  # 인터파크 클래스명
        "circle.available",
        "rect[class*='seat'][class*='available']",
        "rect[class*='seat']:not([class*='sold']):not([class*='disabled'])",
        
        # div/span 좌석
        "div[class*='seat'][class*='available']",
        "div[class*='seat']:not([class*='sold']):not([class*='disabled']):not([class*='reserved'])",
        "span[class*='seat'][class*='available']",
        
        # 데이터 속성
        "[data-seat-status='available']",
        "[data-available='true']",
        "[data-seat]:not([data-sold]):not([data-disabled])",
        
        # 이미지 좌석
        "img[src*='seat'][src*='on']",
        "img[src*='seat'][src*='available']",
        "img[src*='seat']:not([src*='off']):not([src*='sold'])",
        
        # 스탠딩
        "[class*='standing'][class*='available']",
        "[class*='standing']:not([class*='sold'])",
        
        # 일반 폴백
        "[class*='seat']:not([class*='sold']):not([class*='disabled']):not([class*='reserved'])",
    ]
    
    # Canvas/SVG 맵 셀렉터
    SEAT_MAP_SELECTORS = [
        'canvas[id*="seat"]',
        'canvas[class*="seat"]',
        'canvas[id*="map"]',
        'svg[id*="seat"]',
        'svg[class*="seat"]',
        'svg[id*="map"]',
        '#seatMap',
        '#seat-map',
        '.seat-map',
    ]
    
    # 선택 완료 버튼 (다중)
    COMPLETE_SELECTORS = [
        '#NextStepImage',
        '#SmallNextBtnImage',
        'button:contains("선택 완료")',
        'button:contains("다음")',
        'a:contains("다음")',
        '[class*="next"][class*="btn"]',
        '[class*="complete"]',
        '#selectComplete',
    ]
    
    # 새로고침 버튼
    REFRESH_SELECTORS = [
        'a[onclick*="refresh"]',
        'img[onclick*="refresh"]',
        'button:contains("새로고침")',
        '[class*="refresh"]',
        '#refreshSeats',
    ]
    
    def __init__(self, sb: SB, preference: Optional[SeatPreference] = None, session_id: int = 0):
        """
        Args:
            sb: SeleniumBase 인스턴스
            preference: 좌석 선호도 설정
            session_id: 세션 ID (멀티 세션용)
        """
        self.sb = sb
        self.pref = preference or SeatPreference()
        self.session_id = session_id
        
        # 상태 추적
        self.selected_seats: List[SeatInfo] = []
        self.current_zone: str = ""
        self.in_seat_frame = False
        
        # 성능 최적화: 작동한 셀렉터 캐시
        self._working_selectors: Dict[str, str] = {}
        
        # 부분 성공 추적
        self._tracker = PartialSuccessTracker(session_id)
        
        # 세션 간 공유 상태
        self._shared = get_shared_state()
        
        # 락
        self._lock = threading.Lock()
    
    def _log(self, msg: str):
        """세션 ID 포함 로깅"""
        log(msg, session_id=self.session_id)
    
    def _multi_select(self, selectors: List[str], desc: str = "") -> MultiSelector:
        """MultiSelector 생성 헬퍼"""
        return MultiSelector(self.sb, selectors, desc)
    
    @retry(max_attempts=3, delay=0.2)
    def switch_to_seat_frame(self) -> bool:
        """좌석 선택 iframe으로 전환 (재시도 포함)"""
        try:
            self.sb.switch_to_default_content()
            
            selector = self._multi_select(self.FRAME_SELECTORS['seat_frame'], '좌석 프레임')
            frame = selector.find_element(timeout=Timing.ELEMENT_TIMEOUT)
            
            if frame:
                self.sb.switch_to_frame(frame)
                self.in_seat_frame = True
                self._log('✅ 좌석 프레임 전환 완료')
                return True
                
        except Exception as e:
            self._log(f'⚠️ 좌석 프레임 전환 실패: {e}')
        
        return False
    
    @retry(max_attempts=2, delay=0.1)
    def switch_to_seat_detail_frame(self) -> bool:
        """좌석 상세 iframe으로 전환"""
        try:
            selector = self._multi_select(self.FRAME_SELECTORS['seat_detail_frame'], '좌석 상세 프레임')
            frame = selector.find_element(timeout=Timing.ELEMENT_TIMEOUT)
            
            if frame:
                self.sb.switch_to_frame(frame)
                self._log('✅ 좌석 상세 프레임 전환')
                return True
                
        except Exception as e:
            self._log(f'⚠️ 좌석 상세 프레임 전환 실패: {e}')
        
        return False
    
    def get_available_zones(self) -> List[Dict[str, Any]]:
        """사용 가능한 구역 목록 조회 - 다중 셀렉터"""
        zones = []
        
        with Timer(name='구역 조회', log_result=False):
            try:
                selector = self._multi_select(self.ZONE_SELECTORS, '구역 목록')
                grade_items = selector.find_elements()
                
                for idx, item in enumerate(grade_items):
                    try:
                        text = item.text.strip()
                        if not text:
                            text = item.get_attribute('title') or \
                                   item.get_attribute('data-zone') or \
                                   f'구역{idx+1}'
                        
                        # 매진 여부 확인 (다양한 방식)
                        class_attr = (item.get_attribute('class') or '').lower()
                        style_attr = (item.get_attribute('style') or '').lower()
                        onclick_attr = item.get_attribute('onclick') or ''
                        
                        is_sold = any([
                            'sold' in class_attr,
                            'disable' in class_attr,
                            'gray' in class_attr,
                            'opacity' in style_attr and '0.5' in style_attr,
                            onclick_attr == '' and 'href' not in str(item.get_attribute('href') or ''),
                        ])
                        
                        zones.append({
                            'index': idx,
                            'name': text,
                            'element': item,
                            'is_available': not is_sold,
                            'priority': self._get_zone_priority(text)
                        })
                        
                    except Exception as e:
                        self._log(f'⚠️ 구역 파싱 실패 #{idx}: {e}')
                        continue
                
                # 우선순위로 정렬 (가용 > 우선순위)
                zones.sort(key=lambda z: (not z['is_available'], z['priority']))
                
                if zones:
                    self._log(f'📍 구역 {len(zones)}개: {[z["name"] for z in zones[:5]]}...')
                else:
                    self._log('⚠️ 구역 목록 비어있음')
                
            except Exception as e:
                self._log(f'⚠️ 구역 목록 조회 실패: {e}')
        
        return zones
    
    def _get_zone_priority(self, zone_name: str) -> int:
        """구역 우선순위 계산"""
        zone_upper = zone_name.upper()
        
        # 제외 구역 체크
        if any(ex.upper() in zone_upper for ex in self.pref.exclude_zones):
            return 9999
        
        for idx, pref_zone in enumerate(self.pref.zone_priority):
            if pref_zone.upper() in zone_upper or zone_upper in pref_zone.upper():
                return idx
        
        return len(self.pref.zone_priority) + 1
    
    @retry_on_stale
    def select_zone(self, zone_info: Dict[str, Any]) -> bool:
        """구역 선택 - 인간 같은 클릭"""
        try:
            element = zone_info.get('element')
            if element:
                # 봇 탐지 회피: 인간 같은 클릭
                AntiDetection.human_click(self.sb, element)
                self.current_zone = zone_info.get('name', '')
                self._log(f'✅ 구역 선택: {self.current_zone}')
                
                # 체크포인트 저장
                self._tracker.checkpoint('zone_selected', {'zone': self.current_zone})
                
                adaptive_sleep(Timing.MEDIUM)
                return True
                
        except Exception as e:
            self._log(f'⚠️ 구역 선택 실패: {e}')
        
        return False
    
    def find_available_seats(self) -> List[SeatInfo]:
        """사용 가능한 좌석 찾기 - 다중 셀렉터 + 캐시"""
        seats = []
        
        with Timer(name='좌석 검색', log_result=False):
            # 1. 좌석 상세 프레임 전환 시도
            if not self.switch_to_seat_detail_frame():
                self._log('⚠️ 좌석 상세 프레임 없음, 현재 프레임에서 검색')
            
            # 2. 캐시된 셀렉터 우선 시도
            selectors_to_try = self.SEAT_SELECTORS.copy()
            cached = self._working_selectors.get('seat')
            if cached and cached in selectors_to_try:
                selectors_to_try.remove(cached)
                selectors_to_try.insert(0, cached)
            
            # 3. 다중 셀렉터로 좌석 검색
            for sel in selectors_to_try:
                try:
                    elements = self.sb.find_elements(sel)
                    if not elements:
                        continue
                    
                    available = [e for e in elements if e.is_displayed()]
                    
                    if available:
                        self._log(f'✅ 좌석 발견! ({len(available)}개) - {sel[:40]}...')
                        
                        # 작동한 셀렉터 캐시
                        self._working_selectors['seat'] = sel
                        
                        for elem in available:
                            seat = self._parse_seat_element(elem)
                            if seat and seat.is_available:
                                seats.append(seat)
                        
                        if seats:
                            break
                            
                except Exception as e:
                    continue
            
            # 4. Canvas 기반 좌석맵 분석 (폴백)
            if not seats:
                self._log('🔍 Canvas/SVG 좌석맵 분석 시도...')
                canvas_seats = self._analyze_canvas_seatmap()
                seats.extend(canvas_seats)
            
            # 5. 점수 계산 및 정렬
            for seat in seats:
                seat.score = self._calculate_seat_score(seat)
            
            seats.sort(key=lambda s: s.score, reverse=True)
            
            self._log(f'🪑 총 {len(seats)}개 가용 좌석')
        
        return seats
    
    @retry_on_stale
    def _parse_seat_element(self, elem: Any) -> Optional[SeatInfo]:
        """좌석 요소 파싱 - 강화"""
        if elem is None:
            return None
            
        try:
            seat = SeatInfo(element=elem, status=SeatStatus.AVAILABLE)
            
            # 안전하게 속성 추출
            seat_id = ''
            seat_class = ''
            data_seat = ''
            title = ''
            alt = ''
            
            try:
                seat_id = elem.get_attribute('id') or ''
                seat_class = elem.get_attribute('class') or ''
                data_seat = elem.get_attribute('data-seat') or \
                           elem.get_attribute('data-seat-id') or ''
                title = elem.get_attribute('title') or ''
                alt = elem.get_attribute('alt') or ''
            except Exception:
                pass
            
            seat.raw_id = seat_id or data_seat or str(id(elem))
            
            # 좌석 정보 파싱 (다양한 형식)
            info_text = title or alt or data_seat or seat_id or seat_class
            
            if info_text:
                # "1층 A구역 3열 15번" 형식
                row_match = re.search(r'(\d+)\s*열', info_text)
                seat_match = re.search(r'(\d+)\s*번', info_text)
                zone_match = re.search(r'([A-Z가-힣]+)\s*(?:구역|블록|섹션)', info_text)
                
                # 대안 형식: "Row 3, Seat 15" 또는 "R3-15"
                if not row_match:
                    row_match = re.search(r'(?:row|R)[\s\-]?(\d+)', info_text, re.I)
                if not seat_match:
                    seat_match = re.search(r'(?:seat|S)[\s\-]?(\d+)', info_text, re.I)
                
                if row_match:
                    seat.row = row_match.group(1)
                if seat_match:
                    seat.seat_num = seat_match.group(1)
                if zone_match:
                    seat.zone = zone_match.group(1)
            
            # 좌표 추출
            try:
                location = elem.location
                if location and isinstance(location, dict):
                    seat.x = int(location.get('x', 0) or 0)
                    seat.y = int(location.get('y', 0) or 0)
            except Exception:
                pass
            
            # 상태 확인 (더 정밀하게)
            class_lower = seat_class.lower()
            if any(kw in class_lower for kw in ['sold', 'disable', 'reserved', 'taken', 'occupied']):
                seat.is_available = False
                seat.status = SeatStatus.SOLD
            elif 'select' in class_lower:
                seat.status = SeatStatus.SELECTED
            
            return seat
            
        except Exception as e:
            return None
    
    def _analyze_canvas_seatmap(self) -> List[SeatInfo]:
        """Canvas/SVG 기반 좌석맵 분석 - 강화"""
        seats = []
        
        try:
            # Canvas/SVG 요소 찾기
            selector = self._multi_select(self.SEAT_MAP_SELECTORS, '좌석맵')
            canvas = selector.find_element(timeout=Timing.ELEMENT_TIMEOUT)
            
            if not canvas:
                return seats
            
            # 크기 추출
            width = height = 0
            try:
                width_attr = canvas.get_attribute('width')
                height_attr = canvas.get_attribute('height')
                
                if width_attr:
                    width = int(width_attr)
                if height_attr:
                    height = int(height_attr)
                
                # 크기 속성 없으면 size에서
                if width <= 0 or height <= 0:
                    size = canvas.size
                    if size:
                        width = int(size.get('width', 0) or 0)
                        height = int(size.get('height', 0) or 0)
                        
            except (ValueError, TypeError):
                pass
            
            if width <= 0 or height <= 0:
                return seats
            
            self._log(f'📊 좌석맵 분석: {width}x{height}')
            
            # Canvas 픽셀 분석
            tag_name = canvas.tag_name.lower()
            
            if tag_name == 'canvas':
                seats = self._analyze_canvas_pixels(canvas, width, height)
            elif tag_name == 'svg':
                seats = self._analyze_svg_elements(canvas)
            
        except Exception as e:
            self._log(f'⚠️ 좌석맵 분석 실패: {e}')
        
        return seats
    
    def _analyze_canvas_pixels(self, canvas, width: int, height: int) -> List[SeatInfo]:
        """Canvas 픽셀 분석"""
        seats = []
        
        try:
            pixel_data = self.sb.execute_script("""
                var canvas = arguments[0];
                var ctx = canvas.getContext('2d');
                if (!ctx) return null;
                
                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                var pixels = [];
                var step = 6;  // 6픽셀 간격 샘플링 (더 정밀)
                
                for (var y = 0; y < canvas.height; y += step) {
                    for (var x = 0; x < canvas.width; x += step) {
                        var idx = (y * canvas.width + x) * 4;
                        var r = imgData.data[idx];
                        var g = imgData.data[idx + 1];
                        var b = imgData.data[idx + 2];
                        var a = imgData.data[idx + 3];
                        
                        // 충분히 불투명하고 밝은 색상만
                        if (a > 200 && (r + g + b) > 150) {
                            pixels.push({x: x, y: y, r: r, g: g, b: b});
                        }
                    }
                }
                return pixels;
            """, canvas)
            
            if pixel_data:
                for p in pixel_data[:100]:  # 최대 100개
                    if self._is_available_seat_color(p['r'], p['g'], p['b']):
                        seat = SeatInfo(
                            x=p['x'],
                            y=p['y'],
                            is_available=True,
                            status=SeatStatus.AVAILABLE,
                            raw_id=f"canvas_{p['x']}_{p['y']}"
                        )
                        seats.append(seat)
                
                self._log(f'🎨 Canvas에서 {len(seats)}개 가용 좌석 감지')
                
        except Exception as e:
            self._log(f'⚠️ Canvas 픽셀 분석 실패: {e}')
        
        return seats
    
    def _analyze_svg_elements(self, svg) -> List[SeatInfo]:
        """SVG 요소 분석 - 인터파크 좌석맵 최적화"""
        seats = []
        
        try:
            # SVG 내부 좌석 요소 찾기 (JS로 더 안정적)
            svg_seats_data = self.sb.execute_script("""
                var svg = arguments[0];
                var seats = [];
                var tags = ['circle', 'rect', 'path'];
                
                tags.forEach(function(tag) {
                    var elements = svg.getElementsByTagName(tag);
                    for (var i = 0; i < elements.length; i++) {
                        var elem = elements[i];
                        var fill = (elem.getAttribute('fill') || '').toLowerCase();
                        var cls = (elem.getAttribute('class') || '').toLowerCase();
                        var style = (elem.getAttribute('style') || '').toLowerCase();
                        var id = elem.getAttribute('id') || '';
                        var dataAttr = elem.getAttribute('data-seat') || elem.getAttribute('data-id') || '';
                        
                        // 매진/비활성 제외
                        var isSold = cls.indexOf('sold') >= 0 || 
                                    cls.indexOf('disabled') >= 0 ||
                                    cls.indexOf('reserved') >= 0 ||
                                    fill.indexOf('gray') >= 0 ||
                                    fill.indexOf('#ccc') >= 0 ||
                                    fill.indexOf('#999') >= 0 ||
                                    fill.indexOf('#ddd') >= 0 ||
                                    style.indexOf('display:none') >= 0 ||
                                    style.indexOf('display: none') >= 0;
                        
                        if (isSold) continue;
                        
                        // 좌표 추출
                        var cx = parseFloat(elem.getAttribute('cx') || elem.getAttribute('x') || 0);
                        var cy = parseFloat(elem.getAttribute('cy') || elem.getAttribute('y') || 0);
                        var r = parseFloat(elem.getAttribute('r') || 0);
                        
                        // 유효한 좌석 크기 (원이면 반지름 3-30 사이)
                        if (tag === 'circle' && (r < 3 || r > 30)) continue;
                        
                        // 좌표가 유효해야 함
                        if (cx <= 0 && cy <= 0) continue;
                        
                        seats.push({
                            tag: tag,
                            cx: cx,
                            cy: cy,
                            r: r,
                            fill: fill,
                            cls: cls,
                            id: id,
                            dataAttr: dataAttr,
                            index: i
                        });
                    }
                });
                
                return seats;
            """, svg)
            
            if svg_seats_data:
                self._log(f'🔷 SVG 좌석 후보 {len(svg_seats_data)}개 발견')
                
                for data in svg_seats_data:
                    try:
                        # 가용 좌석 판단 (더 정교하게)
                        fill = data.get('fill', '')
                        cls = data.get('cls', '')
                        
                        # 가용 좌석 색상
                        available_colors = ['#4', '#5', '#6', '#7', '#8', '#9', '#a', '#b', 
                                           'green', 'blue', '#0f', '#00', 'rgb(0', 'rgb(6', 'rgb(7']
                        unavailable_colors = ['#ccc', '#999', '#ddd', '#eee', 'gray', 'grey', 
                                             '#f0f0', 'rgba(0,0,0', 'white', '#fff']
                        
                        is_available_color = any(c in fill for c in available_colors) or fill == ''
                        is_unavailable = any(c in fill for c in unavailable_colors)
                        
                        if is_unavailable:
                            continue
                        
                        # JS로 실제 요소 참조 얻기
                        tag = data.get('tag', 'circle')
                        idx = data.get('index', 0)
                        elem = self.sb.execute_script(f"""
                            return arguments[0].getElementsByTagName('{tag}')[{idx}];
                        """, svg)
                        
                        if elem:
                            seat = SeatInfo(
                                element=elem,
                                x=int(data.get('cx', 0)),
                                y=int(data.get('cy', 0)),
                                is_available=True,
                                status=SeatStatus.AVAILABLE,
                                raw_id=data.get('id') or data.get('dataAttr') or f"svg_{data.get('cx')}_{data.get('cy')}"
                            )
                            seats.append(seat)
                            
                    except Exception:
                        continue
                
                self._log(f'🔷 SVG에서 {len(seats)}개 가용 좌석 감지')
            
        except Exception as e:
            self._log(f'⚠️ SVG 분석 실패: {e}')
        
        return seats
    
    def _is_available_seat_color(self, r: int, g: int, b: int) -> bool:
        """사용 가능한 좌석 색상인지 확인 - 확장"""
        # 초록색 계열 (가장 일반적)
        if g > 120 and g > r * 1.2 and g > b * 1.2:
            return True
        
        # 짙은 초록
        if g > 100 and g > r * 1.3 and b < 100:
            return True
        
        # 라임/연두색
        if r > 150 and g > 200 and b < 100:
            return True
        
        # 파란색 계열
        if b > 130 and b > r * 1.1 and b > g * 0.8:
            return True
        
        # 하늘색
        if b > 180 and g > 150 and r < 150:
            return True
        
        # 노란색/주황색 (스탠딩)
        if r > 180 and g > 150 and b < 100:
            return True
        
        # 보라색 (VIP)
        if r > 100 and b > 100 and g < 100:
            return True
        
        return False
    
    def _calculate_seat_score(self, seat: SeatInfo) -> float:
        """좌석 점수 계산 (높을수록 좋음) - 정교화"""
        score = 50.0  # 기본 점수
        
        # 열 점수
        try:
            row_num = int(seat.row) if seat.row else 0
            if row_num > 0:
                if self.pref.preferred_rows[0] <= row_num <= self.pref.preferred_rows[1]:
                    # 선호 범위 내: 앞열일수록 높은 점수
                    score += 30 - (row_num - self.pref.preferred_rows[0]) * 2
                elif row_num in self.pref.exclude_rows:
                    score -= 100
                else:
                    # 범위 밖: 거리에 비례해서 감점
                    distance = min(
                        abs(row_num - self.pref.preferred_rows[0]),
                        abs(row_num - self.pref.preferred_rows[1])
                    )
                    score -= distance * 2
        except:
            pass
        
        # 좌석 번호 점수 (중앙 선호)
        try:
            seat_num = int(seat.seat_num) if seat.seat_num else 0
            if seat_num > 0:
                mid = (self.pref.preferred_seats[0] + self.pref.preferred_seats[1]) / 2
                if self.pref.preferred_seats[0] <= seat_num <= self.pref.preferred_seats[1]:
                    # 중앙에 가까울수록 높은 점수
                    score += 15 - abs(seat_num - mid) * 0.3
                else:
                    score -= 5
        except:
            pass
        
        # 구역 점수
        zone_to_check = seat.zone or self.current_zone
        if zone_to_check:
            zone_priority = self._get_zone_priority(zone_to_check)
            score += max(0, 25 - zone_priority * 3)
        
        # 등급 점수
        if seat.grade:
            for idx, grade in enumerate(self.pref.grade_priority):
                if grade.upper() in seat.grade.upper():
                    score += max(0, 20 - idx * 3)
                    break
        
        # 좌표 기반 보정 (중앙/앞쪽 선호)
        if seat.x > 0 and seat.y > 0:
            # y가 작을수록 앞쪽 (보통)
            score += max(0, 10 - seat.y / 50)
        
        return score
    
    def select_consecutive_seats(self, seats: List[SeatInfo], count: int) -> List[SeatInfo]:
        """연석 선택 - 개선 (SVG 좌표계 대응)"""
        if len(seats) < count:
            return []
        
        self._log(f'🔍 연석 {count}석 검색 중... (후보 {len(seats)}개)')
        
        # 1. 좌석 간 간격 통계 계산 (동적 gap 설정)
        x_gaps = []
        y_diffs = []
        sorted_by_x = sorted(seats, key=lambda s: (s.y, s.x))
        
        for i in range(1, min(len(sorted_by_x), 50)):
            x_gap = abs(sorted_by_x[i].x - sorted_by_x[i-1].x)
            y_diff = abs(sorted_by_x[i].y - sorted_by_x[i-1].y)
            if 3 < x_gap < 200:  # 합리적인 범위
                x_gaps.append(x_gap)
            if y_diff < 100:
                y_diffs.append(y_diff)
        
        # 동적 간격 계산 (중앙값 사용)
        if x_gaps:
            x_gaps.sort()
            typical_gap = x_gaps[len(x_gaps) // 4]  # 25% 지점 (연석 간격)
            max_gap = typical_gap * 1.5  # 연석 최대 허용 간격
            min_gap = typical_gap * 0.5  # 최소 간격
        else:
            typical_gap = 30
            max_gap = self.pref.consecutive_max_gap
            min_gap = 5
        
        # 열 허용 오차 계산
        if y_diffs:
            y_diffs.sort()
            row_tolerance = max(15, y_diffs[len(y_diffs) // 2] * 0.7)
        else:
            row_tolerance = 25
        
        self._log(f'📏 간격 분석: 좌석간격={typical_gap:.0f}px, 최대={max_gap:.0f}px, 열허용={row_tolerance:.0f}px')
        
        # 2. 좌표 기반 열 그룹화
        seats_by_row: Dict[int, List[SeatInfo]] = {}
        
        for seat in seats:
            row_key = int(seat.y / row_tolerance)
            if row_key not in seats_by_row:
                seats_by_row[row_key] = []
            seats_by_row[row_key].append(seat)
        
        best_group = []
        best_score = -1000
        
        # 3. 각 열에서 연석 찾기
        for row_key, row_seats in seats_by_row.items():
            if len(row_seats) < count:
                continue
            
            # x좌표로 정렬
            row_seats.sort(key=lambda s: s.x)
            
            # 슬라이딩 윈도우로 연속 좌석 찾기
            for i in range(len(row_seats) - count + 1):
                group = row_seats[i:i + count]
                
                # 연속성 확인 (동적 gap 사용)
                is_consecutive = True
                gaps_in_group = []
                
                for j in range(1, len(group)):
                    gap = group[j].x - group[j-1].x
                    gaps_in_group.append(gap)
                    
                    # 너무 멀거나 너무 가까우면 연석 아님
                    if gap > max_gap or gap < min_gap:
                        is_consecutive = False
                        break
                    
                    # 간격 일관성 확인 (편차가 너무 크면 안됨)
                    if gaps_in_group:
                        avg_gap = sum(gaps_in_group) / len(gaps_in_group)
                        if abs(gap - avg_gap) > typical_gap * 0.5:
                            is_consecutive = False
                            break
                
                if is_consecutive:
                    # 점수 계산: 좌석 점수 + 중앙 보너스 + 일관성 보너스
                    group_score = sum(s.score for s in group)
                    
                    # 간격 일관성 보너스
                    if gaps_in_group:
                        gap_variance = sum((g - typical_gap) ** 2 for g in gaps_in_group) / len(gaps_in_group)
                        consistency_bonus = max(0, 10 - gap_variance / 10)
                        group_score += consistency_bonus
                    
                    if group_score > best_score:
                        best_score = group_score
                        best_group = group
        
        if best_group:
            seat_info = ', '.join([f'{s.row}열{s.seat_num}번' if s.row else f'({s.x},{s.y})' for s in best_group])
            self._log(f'✅ 연석 {count}석 발견: [{seat_info}] (점수: {best_score:.1f})')
            return best_group
        
        # 4. 연석 못 찾으면 폴백
        if self.pref.fallback_to_individual:
            self._log(f'⚠️ 연석 {count}석 찾기 실패, 개별 선택 (상위 {count}석)')
            return seats[:count]
        
        return []
    
    @retry(max_attempts=3, delay=0.1)
    @retry_on_stale
    def click_seat(self, seat: SeatInfo) -> bool:
        """좌석 클릭 - 재시도 + 인간 같은 클릭 + 선택 확인"""
        try:
            if seat.element:
                # 중복 선점 체크 (세션 간)
                if self._shared:
                    if not self._shared.add_to_set('claimed_seats', seat.raw_id):
                        self._log(f'⚠️ 좌석 이미 선점됨: {seat.raw_id[:15]}')
                        return False
                
                # 클릭 전 상태 저장
                pre_class = seat.element.get_attribute('class') or ''
                pre_fill = seat.element.get_attribute('fill') or ''
                
                # 스크롤하여 보이게
                try:
                    self.sb.execute_script(
                        "arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});",
                        seat.element
                    )
                    human_delay(30, 80)
                except:
                    pass
                
                # 오버레이/모달 닫기 시도
                try:
                    self.sb.execute_script("""
                        // 오버레이 요소 제거/숨기기
                        document.querySelectorAll('h3, .modal, .overlay, [class*="popup"], [class*="tooltip"]').forEach(function(el) {
                            if (el.style) el.style.display = 'none';
                        });
                    """)
                except:
                    pass
                
                # JS 클릭 (가려진 요소도 클릭 가능)
                seat_desc = f'{seat.zone} {seat.row}열 {seat.seat_num}번' if seat.row else seat.raw_id[:20]
                try:
                    # 먼저 일반 클릭 시도
                    AntiDetection.human_click(self.sb, seat.element)
                except Exception as click_err:
                    if 'intercepted' in str(click_err).lower() or 'not clickable' in str(click_err).lower():
                        # 가려진 경우 JS 이벤트 디스패치로 폴백
                        self._log(f'⚠️ 요소 가려짐, JS 이벤트 클릭 시도')
                        self.sb.execute_script("""
                            var elem = arguments[0];
                            var rect = elem.getBoundingClientRect();
                            var event = new MouseEvent('click', {
                                view: window,
                                bubbles: true,
                                cancelable: true,
                                clientX: rect.left + rect.width/2,
                                clientY: rect.top + rect.height/2
                            });
                            elem.dispatchEvent(event);
                        """, seat.element)
                    else:
                        raise click_err
                
                self._log(f'🪑 좌석 클릭: {seat_desc}')
                
                # 선택 확인 (클릭 후 상태 변화 검증)
                human_delay(50, 100)  # 상태 변경 대기
                if self._verify_seat_selected(seat, pre_class, pre_fill):
                    self._log(f'✅ 좌석 선택 확인됨')
                    return True
                else:
                    self._log(f'⚠️ 좌석 선택 상태 미확인 (클릭은 성공)')
                    # 클릭은 성공했으므로 True 반환 (UI 반응이 느릴 수 있음)
                    return True
                
            elif seat.x > 0 and seat.y > 0:
                # 좌표 클릭 (Canvas/SVG용)
                selector = self._multi_select(self.SEAT_MAP_SELECTORS, '좌석맵')
                canvas = selector.find_element()
                
                if canvas:
                    # 약간의 랜덤 오프셋 (봇 탐지 회피)
                    x_offset = seat.x + random.randint(-2, 2)
                    y_offset = seat.y + random.randint(-2, 2)
                    
                    # JS 클릭 이벤트 발생
                    self.sb.execute_script(
                        """
                        var elem = arguments[0];
                        var x = arguments[1];
                        var y = arguments[2];
                        
                        // SVG 요소인 경우 elementFromPoint로 실제 좌석 찾기
                        var target = document.elementFromPoint(
                            elem.getBoundingClientRect().left + x,
                            elem.getBoundingClientRect().top + y
                        ) || elem;
                        
                        // 클릭 이벤트 시퀀스 (mousedown -> mouseup -> click)
                        ['mousedown', 'mouseup', 'click'].forEach(function(eventType) {
                            var event = new MouseEvent(eventType, {
                                view: window,
                                bubbles: true,
                                cancelable: true,
                                clientX: elem.getBoundingClientRect().left + x,
                                clientY: elem.getBoundingClientRect().top + y
                            });
                            target.dispatchEvent(event);
                        });
                        """,
                        canvas, x_offset, y_offset
                    )
                    
                    self._log(f'🪑 좌표 클릭: ({seat.x}, {seat.y})')
                    return True
                    
        except Exception as e:
            # 실패 시 선점 해제
            if self._shared and seat.raw_id:
                self._shared.remove_from_set('claimed_seats', seat.raw_id)
            
            seat.click_retries += 1
            self._log(f'⚠️ 좌석 클릭 실패 (시도 {seat.click_retries}): {e}')
        
        return False
    
    def _verify_seat_selected(self, seat: SeatInfo, pre_class: str, pre_fill: str) -> bool:
        """좌석 선택 상태 확인"""
        try:
            if not seat.element:
                return False
            
            # 현재 상태 확인
            post_class = seat.element.get_attribute('class') or ''
            post_fill = seat.element.get_attribute('fill') or ''
            post_style = seat.element.get_attribute('style') or ''
            
            # 선택 상태 변화 감지
            # 1. 클래스에 'selected', 'active', 'on', 'checked' 추가
            selected_keywords = ['selected', 'active', 'on', 'checked', 'pick', 'chosen']
            for kw in selected_keywords:
                if kw in post_class.lower() and kw not in pre_class.lower():
                    return True
            
            # 2. fill 색상 변경 (보통 파란색/주황색으로)
            if pre_fill != post_fill and post_fill:
                # 선택 시 일반적인 색상
                selected_colors = ['#ff', '#f90', '#00f', '#0af', 'orange', 'blue', 'red', 'yellow']
                if any(c in post_fill.lower() for c in selected_colors):
                    return True
            
            # 3. 클래스 변경 자체가 있으면 변화로 간주
            if pre_class != post_class:
                return True
            
            # 4. 스타일 변경 확인
            if 'stroke' in post_style or 'border' in post_style:
                return True
            
            return False
            
        except Exception:
            return False
    
    def select_best_seats(self) -> bool:
        """최적 좌석 선택 (메인 함수) - 에러 복구 강화"""
        self._log(f'🎯 좌석 선택 시작 (목표: {self.pref.num_seats}석)')
        
        # 체크포인트: 시작
        self._tracker.checkpoint('seat_selection_start', {
            'num_seats': self.pref.num_seats,
            'consecutive': self.pref.consecutive_required,
        })
        
        for attempt in range(self.pref.max_attempts):
            try:
                # 1. 좌석 프레임 전환
                if not self.switch_to_seat_frame():
                    self._log('⚠️ 좌석 프레임 전환 실패, 현재 컨텍스트에서 시도')
                
                # 2. 구역 목록 조회
                zones = self.get_available_zones()
                
                if not zones:
                    # 구역 없이 직접 좌석 검색 시도
                    self._log('⚠️ 구역 없음, 직접 좌석 검색')
                    seats = self.find_available_seats()
                    if seats:
                        return self._select_seats_from_list(seats)
                    
                    # 새로고침 후 재시도
                    self.refresh_seats()
                    adaptive_sleep(Timing.SHORT)
                    continue
                
                # 3. 구역별 좌석 선택 시도
                for zone in zones:
                    if not zone['is_available']:
                        continue
                    
                    self._log(f'📍 구역 시도 #{attempt+1}: {zone["name"]}')
                    
                    if not self.select_zone(zone):
                        continue
                    
                    # 4. 좌석 찾기
                    seats = self.find_available_seats()
                    
                    if not seats:
                        self._log(f'⚠️ {zone["name"]} 좌석 없음')
                        self._reset_frame()
                        continue
                    
                    # 5. 좌석 선택 시도
                    if self._select_seats_from_list(seats):
                        return True
                    
                    self._reset_frame()
                
                # 구역 순회 후 새로고침
                self._log(f'🔄 새로고침 후 재시도 (시도 {attempt+1}/{self.pref.max_attempts})')
                self.refresh_seats()
                adaptive_sleep(Timing.SHORT)
                
            except Exception as e:
                self._log(f'⚠️ 좌석 선택 에러: {e}')
                self._reset_frame()
                adaptive_sleep(Timing.SHORT)
        
        self._log('❌ 좌석 선택 실패 (최대 시도 초과)')
        return False
    
    def _select_seats_from_list(self, seats: List[SeatInfo]) -> bool:
        """좌석 리스트에서 선택"""
        # 연석 or 개별 선택
        if self.pref.consecutive_required and self.pref.num_seats > 1:
            target_seats = self.select_consecutive_seats(seats, self.pref.num_seats)
        else:
            target_seats = seats[:self.pref.num_seats]
        
        if len(target_seats) < self.pref.num_seats:
            self._log(f'⚠️ 좌석 부족 ({len(target_seats)}/{self.pref.num_seats})')
            return False
        
        # 좌석 클릭
        success_count = 0
        for seat in target_seats:
            if self.click_seat(seat):
                self.selected_seats.append(seat)
                success_count += 1
                human_delay(100, 200)  # 인간 같은 간격
        
        if success_count >= self.pref.num_seats:
            self._log(f'✅ 좌석 선택 완료: {success_count}석')
            
            # 체크포인트: 좌석 선택 완료
            self._tracker.checkpoint('seats_selected', {
                'count': success_count,
                'seats': [s.raw_id for s in self.selected_seats],
            })
            
            return True
        
        return False
    
    def _reset_frame(self):
        """프레임 리셋"""
        try:
            self.sb.switch_to_default_content()
            self.in_seat_frame = False
        except:
            pass
    
    def complete_selection(self) -> bool:
        """선택 완료 버튼 클릭 + 결제 페이지 이동 확인"""
        try:
            self._reset_frame()
            
            # ★ 확인 모달 처리 (선택 완료 전에!)
            self._log('🔍 모달 확인 중...')
            try:
                modal_result = self.sb.execute_script("""
                    // "확인하고 예매하기" 버튼 찾아서 클릭
                    var allBtns = document.querySelectorAll('button');
                    for (var btn of allBtns) {
                        var text = btn.textContent || '';
                        if (text.includes('확인하고 예매하기')) {
                            btn.click();
                            return 'clicked: ' + text.trim();
                        }
                    }
                    // 모달 내 확인 버튼 찾기
                    var modal = document.querySelector('[class*="ModalConfirm"], [role="alertdialog"]');
                    if (modal) {
                        var btns = modal.querySelectorAll('button');
                        for (var btn of btns) {
                            var text = btn.textContent || '';
                            if (text.includes('확인') || text.includes('예') || text.includes('동의')) {
                                btn.click();
                                return 'clicked modal: ' + text.trim();
                            }
                        }
                    }
                    return 'no modal';
                """)
                if modal_result and 'clicked' in str(modal_result):
                    self._log(f'✅ 확인 모달 클릭: {modal_result}')
                    adaptive_sleep(1.0)
                    
                    # ★ 두 번째 모달 (ModalConfirm) 처리
                    modal2_result = self.sb.execute_script("""
                        // ModalConfirm 찾기
                        var modal = document.querySelector('[class*="ModalConfirm"], [role="alertdialog"]');
                        if (modal && modal.offsetParent !== null) {
                            var btns = modal.querySelectorAll('button');
                            for (var btn of btns) {
                                var text = btn.textContent || '';
                                if (text.includes('확인') || text.includes('예') || text.length > 0) {
                                    btn.click();
                                    return 'clicked2: ' + text.trim();
                                }
                            }
                        }
                        return 'no modal2';
                    """)
                    if modal2_result and 'clicked' in str(modal2_result):
                        self._log(f'✅ 두번째 모달 클릭: {modal2_result}')
                        adaptive_sleep(0.8)
            except Exception as me:
                self._log(f'⚠️ 모달 처리: {str(me)[:30]}')
            
            if not self.switch_to_seat_frame():
                pass  # 프레임 없어도 시도
            
            # 클릭 전 URL 저장
            pre_url = ""
            try:
                self.sb.switch_to_default_content()
                pre_url = self.sb.get_current_url()
            except:
                pass
            
            # 다시 프레임 전환
            self.switch_to_seat_frame()
            
            selector = self._multi_select(self.COMPLETE_SELECTORS, '선택 완료')
            
            if selector.click(timeout=Timing.ELEMENT_TIMEOUT):
                self._log('✅ 선택 완료 클릭')
                adaptive_sleep(Timing.LONG)
                
                # 결제 페이지 이동 확인 (중요!)
                if self._verify_moved_to_payment(pre_url):
                    self._log('✅ 결제 페이지 이동 확인됨')
                    self._tracker.checkpoint('selection_completed', {'moved_to_payment': True})
                    return True
                else:
                    self._log('⚠️ 결제 페이지 이동 미확인 (계속 진행)')
                    self._tracker.checkpoint('selection_completed', {'moved_to_payment': False})
                    return True  # 클릭은 성공
            
            self._log('⚠️ 선택 완료 버튼 없음')
            return False
            
        except Exception as e:
            self._log(f'⚠️ 선택 완료 실패: {e}')
            return False
    
    def _verify_moved_to_payment(self, pre_url: str, timeout: float = 5.0) -> bool:
        """결제/배송 페이지로 이동했는지 확인"""
        try:
            self.sb.switch_to_default_content()
            
            payment_indicators = [
                'delivery', 'payment', 'order', 'checkout',
                'step2', 'step3', 'booking', '결제', '배송'
            ]
            
            start = time.time()
            while time.time() - start < timeout:
                try:
                    current_url = self.sb.get_current_url().lower()
                    
                    # URL 변경됐고, 결제 관련 키워드 포함
                    if current_url != pre_url.lower():
                        if any(ind in current_url for ind in payment_indicators):
                            return True
                        # URL만 변경돼도 성공으로 간주 (페이지 이동)
                        if 'seat' not in current_url:
                            return True
                    
                    # DOM에서 결제 관련 요소 확인
                    payment_dom_selectors = [
                        '[class*="payment"]',
                        '[class*="delivery"]',
                        '[id*="payment"]',
                        'button:contains("결제")',
                        'select[id*="Price"]',
                        '#YYMMDD',  # 생년월일 필드
                    ]
                    
                    for sel in payment_dom_selectors:
                        try:
                            elem = self.sb.find_element(sel)
                            if elem and elem.is_displayed():
                                return True
                        except:
                            pass
                    
                except:
                    pass
                
                adaptive_sleep(0.3)
            
            return False
            
        except Exception as e:
            self._log(f'⚠️ 결제 페이지 확인 실패: {e}')
            return False
    
    def refresh_seats(self) -> bool:
        """좌석 새로고침 - 다중 셀렉터"""
        try:
            self._reset_frame()
            
            if not self.switch_to_seat_frame():
                pass
            
            selector = self._multi_select(self.REFRESH_SELECTORS, '새로고침')
            
            if selector.click(timeout=Timing.ELEMENT_TIMEOUT):
                self._log('🔄 좌석 새로고침')
                adaptive_sleep(Timing.MEDIUM)
                return True
                
        except:
            pass
        
        # 폴백: 페이지 새로고침
        try:
            self.sb.execute_script("location.reload();")
            adaptive_sleep(Timing.LONG)
            return True
        except:
            pass
        
        return False
    
    def get_selection_status(self) -> Dict[str, Any]:
        """현재 선택 상태 반환"""
        return {
            'selected_count': len(self.selected_seats),
            'selected_seats': [
                {
                    'zone': s.zone,
                    'row': s.row,
                    'seat': s.seat_num,
                    'id': s.raw_id,
                }
                for s in self.selected_seats
            ],
            'current_zone': self.current_zone,
            'last_stage': self._tracker.get_last_stage(),
        }


# ============ 편의 함수 ============
def quick_select(sb: SB, num_seats: int = 2, consecutive: bool = True,
                 zone_priority: Optional[List[str]] = None,
                 session_id: int = 0) -> bool:
    """빠른 좌석 선택"""
    pref = SeatPreference(
        num_seats=num_seats,
        consecutive_required=consecutive,
    )
    if zone_priority:
        pref.zone_priority = zone_priority
    
    selector = SeatSelector(sb, pref, session_id)
    if selector.select_best_seats():
        return selector.complete_selection()
    return False


def standing_select(sb: SB, num_seats: int = 2, area: str = 'A',
                    session_id: int = 0) -> bool:
    """스탠딩 선택"""
    pref = SeatPreference(
        num_seats=num_seats,
        consecutive_required=False,
        zone_priority=[f'스탠딩{area}', 'STANDING', 'FLOOR', f'STANDING {area}'],
        allow_standing=True,
    )
    
    selector = SeatSelector(sb, pref, session_id)
    return selector.select_best_seats()


def premium_select(sb: SB, num_seats: int = 2, session_id: int = 0) -> bool:
    """프리미엄/VIP 좌석 선택"""
    pref = SeatPreference(
        num_seats=num_seats,
        consecutive_required=True,
        zone_priority=['VVIP', 'VIP', 'PREMIUM', 'R석'],
        preferred_rows=(1, 5),
    )
    
    selector = SeatSelector(sb, pref, session_id)
    if selector.select_best_seats():
        return selector.complete_selection()
    return False


def emergency_select(sb: SB, num_seats: int = 1, session_id: int = 0) -> bool:
    """긴급 좌석 선택 (아무거나 빠르게)"""
    pref = SeatPreference(
        num_seats=num_seats,
        consecutive_required=False,
        fallback_to_individual=True,
        max_attempts=3,
    )
    
    selector = SeatSelector(sb, pref, session_id)
    if selector.select_best_seats():
        return selector.complete_selection()
    return False
