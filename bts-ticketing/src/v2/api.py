"""
인터파크 API 클라이언트 - 직접 호출
"""
import httpx
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from .session import AuthSession

@dataclass
class SeatInfo:
    """좌석 정보"""
    seat_id: str
    zone: str
    row: str
    number: str
    grade: str
    price: int
    status: str  # available, selected, sold

@dataclass
class BookingResult:
    """예매 결과"""
    success: bool
    booking_token: Optional[str] = None
    seats: List[SeatInfo] = None
    error: Optional[str] = None
    
    def __post_init__(self):
        if self.seats is None:
            self.seats = []


class InterParkAPI:
    """인터파크 티켓 API 클라이언트"""
    
    BASE_URL = "https://tickets.interpark.com"
    API_URL = "https://poapi.interpark.com"
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': 'https://tickets.interpark.com',
        'Referer': 'https://tickets.interpark.com/',
    }
    
    def __init__(self, session: AuthSession):
        self.session = session
        self.client = session.http_client
    
    def get_goods_info(self, goods_id: str) -> Dict[str, Any]:
        """공연 정보 조회"""
        url = f"{self.BASE_URL}/api/goods/{goods_id}"
        try:
            resp = self.client.get(url, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {}
        except Exception as e:
            return {'error': str(e)}
    
    def get_schedules(self, goods_id: str) -> List[Dict]:
        """회차 목록 조회"""
        url = f"{self.BASE_URL}/api/goods/{goods_id}/schedules"
        try:
            resp = self.client.get(url, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else []
        except Exception:
            return []
    
    def enter_queue(self, goods_id: str, schedule_id: str) -> Dict[str, Any]:
        """대기열 진입"""
        url = f"{self.API_URL}/api/queue/enter"
        data = {
            'goods_id': goods_id,
            'schedule_id': schedule_id
        }
        try:
            resp = self.client.post(url, json=data, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {'error': resp.text}
        except Exception as e:
            return {'error': str(e)}
    
    def check_queue_status(self, queue_token: str) -> Dict[str, Any]:
        """대기열 상태 확인"""
        url = f"{self.API_URL}/api/queue/status"
        try:
            resp = self.client.get(url, params={'token': queue_token}, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {}
        except Exception:
            return {}
    
    def get_seat_map(self, schedule_id: str) -> Dict[str, Any]:
        """좌석맵 조회"""
        url = f"{self.API_URL}/api/seats/{schedule_id}/map"
        try:
            resp = self.client.get(url, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {}
        except Exception:
            return {}
    
    def select_seats(self, schedule_id: str, seat_ids: List[str]) -> BookingResult:
        """좌석 선택"""
        url = f"{self.API_URL}/api/seats/select"
        data = {
            'schedule_id': schedule_id,
            'seat_ids': seat_ids
        }
        try:
            resp = self.client.post(url, json=data, headers=self.HEADERS)
            if resp.status_code == 200:
                result = resp.json()
                return BookingResult(
                    success=result.get('success', False),
                    booking_token=result.get('booking_token'),
                    seats=[SeatInfo(**s) for s in result.get('seats', [])]
                )
            return BookingResult(success=False, error=resp.text)
        except Exception as e:
            return BookingResult(success=False, error=str(e))
    
    def init_payment(self, booking_token: str, payment_method: str = "kakaopay") -> Dict[str, Any]:
        """결제 초기화"""
        url = f"{self.API_URL}/api/payment/init"
        data = {
            'booking_token': booking_token,
            'payment_method': payment_method
        }
        try:
            resp = self.client.post(url, json=data, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {'error': resp.text}
        except Exception as e:
            return {'error': str(e)}
    
    def confirm_payment(self, payment_data: Dict) -> Dict[str, Any]:
        """결제 확인"""
        url = f"{self.API_URL}/api/payment/confirm"
        try:
            resp = self.client.post(url, json=payment_data, headers=self.HEADERS)
            return resp.json() if resp.status_code == 200 else {'error': resp.text}
        except Exception as e:
            return {'error': str(e)}
    
    def keep_alive(self) -> bool:
        """세션 유지"""
        try:
            resp = self.client.get(f"{self.BASE_URL}/", headers=self.HEADERS)
            self.session.update_activity()
            return resp.status_code == 200
        except Exception:
            return False
