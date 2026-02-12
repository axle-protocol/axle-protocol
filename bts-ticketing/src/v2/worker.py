"""
예매 워커 - 멀티프로세스
"""
import time
import multiprocessing as mp
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from queue import Empty
from session import AuthSession
from api import InterParkAPI, BookingResult, SeatInfo

@dataclass
class WorkerResult:
    """워커 결과"""
    worker_id: int
    account_id: str
    success: bool
    booking_token: Optional[str] = None
    seats: List[SeatInfo] = None
    error: Optional[str] = None
    elapsed_ms: float = 0

    def __post_init__(self):
        if self.seats is None:
            self.seats = []


class BookingWorker(mp.Process):
    """예매 워커 프로세스"""
    
    def __init__(
        self,
        worker_id: int,
        session_data: dict,
        goods_id: str,
        schedule_id: str,
        seat_count: int,
        prefer_zones: List[str],
        result_queue: mp.Queue,
        stop_event: mp.Event,
        start_event: mp.Event
    ):
        super().__init__()
        self.worker_id = worker_id
        self.session_data = session_data
        self.goods_id = goods_id
        self.schedule_id = schedule_id
        self.seat_count = seat_count
        self.prefer_zones = prefer_zones
        self.result_queue = result_queue
        self.stop_event = stop_event
        self.start_event = start_event
    
    def run(self):
        """워커 실행"""
        # 세션 복원
        session = AuthSession.from_dict(self.session_data)
        api = InterParkAPI(session)
        
        print(f"[Worker {self.worker_id}] 대기 중...")
        
        # 시작 신호 대기
        self.start_event.wait()
        
        if self.stop_event.is_set():
            return
        
        print(f"[Worker {self.worker_id}] 🚀 예매 시작!")
        start_time = time.time()
        
        try:
            # 좌석맵 조회
            seat_map = api.get_seat_map(self.schedule_id)
            if not seat_map or 'error' in seat_map:
                self._report_error("좌석맵 조회 실패", start_time)
                return
            
            # 좌석 선택 (선호 구역 우선)
            available_seats = self._find_available_seats(seat_map, self.seat_count)
            if not available_seats:
                self._report_error("이용 가능한 좌석 없음", start_time)
                return
            
            # 좌석 선점
            seat_ids = [s['seat_id'] for s in available_seats]
            result = api.select_seats(self.schedule_id, seat_ids)
            
            elapsed = (time.time() - start_time) * 1000
            
            if result.success:
                print(f"[Worker {self.worker_id}] ✅ 좌석 선점 성공! ({elapsed:.0f}ms)")
                self.result_queue.put(WorkerResult(
                    worker_id=self.worker_id,
                    account_id=session.account_id,
                    success=True,
                    booking_token=result.booking_token,
                    seats=result.seats,
                    elapsed_ms=elapsed
                ))
                # 다른 워커 중지
                self.stop_event.set()
            else:
                self._report_error(result.error or "좌석 선점 실패", start_time)
        
        except Exception as e:
            self._report_error(str(e), start_time)
        finally:
            session.close()
    
    def _find_available_seats(self, seat_map: Dict, count: int) -> List[Dict]:
        """이용 가능한 좌석 찾기"""
        seats = seat_map.get('seats', [])
        available = [s for s in seats if s.get('status') == 'available']
        
        # 선호 구역 우선
        if self.prefer_zones:
            for zone in self.prefer_zones:
                zone_seats = [s for s in available if s.get('zone') == zone]
                if len(zone_seats) >= count:
                    return zone_seats[:count]
        
        return available[:count]
    
    def _report_error(self, error: str, start_time: float):
        """에러 보고"""
        elapsed = (time.time() - start_time) * 1000
        print(f"[Worker {self.worker_id}] ❌ {error} ({elapsed:.0f}ms)")
        self.result_queue.put(WorkerResult(
            worker_id=self.worker_id,
            account_id=self.session_data.get('account_id', ''),
            success=False,
            error=error,
            elapsed_ms=elapsed
        ))


class ProcessOrchestrator:
    """멀티프로세스 오케스트레이터"""
    
    def __init__(self):
        self.workers: List[BookingWorker] = []
        self.result_queue = mp.Queue()
        self.stop_event = mp.Event()
        self.start_event = mp.Event()
    
    def spawn_workers(
        self,
        sessions: List[AuthSession],
        goods_id: str,
        schedule_id: str,
        seat_count: int = 2,
        prefer_zones: List[str] = None
    ) -> int:
        """워커 생성"""
        for i, session in enumerate(sessions):
            worker = BookingWorker(
                worker_id=i,
                session_data=session.to_dict(),
                goods_id=goods_id,
                schedule_id=schedule_id,
                seat_count=seat_count,
                prefer_zones=prefer_zones or [],
                result_queue=self.result_queue,
                stop_event=self.stop_event,
                start_event=self.start_event
            )
            self.workers.append(worker)
            worker.start()
        
        print(f"✅ {len(self.workers)}개 워커 생성 완료")
        return len(self.workers)
    
    def start_attack(self):
        """공격 시작"""
        print("🚀 전체 공격 시작!")
        self.start_event.set()
    
    def wait_for_result(self, timeout: float = 60) -> Optional[WorkerResult]:
        """결과 대기"""
        try:
            result = self.result_queue.get(timeout=timeout)
            if result.success:
                return result
        except Empty:
            pass
        return None
    
    def stop_all(self):
        """모든 워커 중지"""
        self.stop_event.set()
        self.start_event.set()  # 대기 중인 워커 깨우기
        
        for worker in self.workers:
            worker.join(timeout=5)
            if worker.is_alive():
                worker.terminate()
        
        self.workers.clear()
    
    def collect_all_results(self) -> List[WorkerResult]:
        """모든 결과 수집"""
        results = []
        while not self.result_queue.empty():
            try:
                results.append(self.result_queue.get_nowait())
            except Empty:
                break
        return results
