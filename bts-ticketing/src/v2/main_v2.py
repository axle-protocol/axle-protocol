#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v2.0
- 사전 로그인 + 세션 풀
- 멀티프로세스 병렬 시도
- API 직접 호출

Usage:
    python main_v2.py --pre-login        # 사전 로그인만
    python main_v2.py --test             # 즉시 테스트
    python main_v2.py --target 20:00     # 20시 예매
"""

import os
import sys
import time
import argparse
from datetime import datetime, timedelta
from typing import Optional

# 모듈 임포트
from config import SystemConfig, Account
from session import SessionPool, AuthSession
from pre_login import pre_login_all, pre_login_account
from worker import ProcessOrchestrator, WorkerResult
from api import InterParkAPI


def log(msg: str, level: str = "INFO"):
    """로깅"""
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] {level}: {msg}")


class BTSTicketing:
    """BTS 티켓팅 시스템 v2.0"""
    
    def __init__(self, config: SystemConfig):
        self.config = config
        self.session_pool = SessionPool(
            session_dir=config.session_dir,
            ttl=config.session_ttl
        )
        self.orchestrator = ProcessOrchestrator()
    
    def initialize(self) -> bool:
        """시스템 초기화"""
        log("🔧 시스템 초기화...")
        
        # 기존 세션 로드
        self.session_pool.load_all()
        log(f"📦 저장된 세션 {self.session_pool.valid_count}개 로드")
        
        return True
    
    def pre_login(self) -> int:
        """사전 로그인"""
        log(f"🔐 사전 로그인 시작 ({len(self.config.accounts)}개 계정)")
        
        count = pre_login_all(self.config.accounts, self.session_pool)
        
        log(f"✅ 사전 로그인 완료: {count}/{len(self.config.accounts)}")
        return count
    
    def wait_for_target_time(self, target_time: str) -> bool:
        """목표 시간까지 대기"""
        try:
            hour, minute = map(int, target_time.split(':'))
            now = datetime.now()
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            
            if target <= now:
                target += timedelta(days=1)
            
            wait_seconds = (target - now).total_seconds()
            log(f"⏰ 목표 시간: {target.strftime('%H:%M')}, 대기: {wait_seconds:.0f}초")
            
            # 1초 전까지 대기
            if wait_seconds > 1:
                time.sleep(wait_seconds - 1)
            
            # 정확한 시간까지 busy wait
            while datetime.now() < target:
                pass
            
            return True
        except Exception as e:
            log(f"❌ 시간 파싱 실패: {e}", "ERROR")
            return False
    
    def run_booking(self, schedule_id: str = "") -> Optional[WorkerResult]:
        """예매 실행"""
        sessions = self.session_pool.get_all_valid()
        if not sessions:
            log("❌ 유효한 세션 없음. --pre-login 먼저 실행하세요.", "ERROR")
            return None
        
        log(f"🎯 예매 시작 (세션 {len(sessions)}개, 좌석 {self.config.seat_count}석)")
        
        # 워커 생성
        self.orchestrator.spawn_workers(
            sessions=sessions,
            goods_id=self.config.goods_id,
            schedule_id=schedule_id or "default",
            seat_count=self.config.seat_count,
            prefer_zones=self.config.prefer_zones
        )
        
        # 공격 시작
        self.orchestrator.start_attack()
        
        # 결과 대기
        result = self.orchestrator.wait_for_result(timeout=60)
        
        # 정리
        self.orchestrator.stop_all()
        
        if result and result.success:
            log(f"🎉 예매 성공! 계정: {result.account_id}, 소요: {result.elapsed_ms:.0f}ms")
            return result
        else:
            log("❌ 예매 실패")
            all_results = self.orchestrator.collect_all_results()
            for r in all_results:
                log(f"  - Worker {r.worker_id}: {r.error}")
            return None
    
    def shutdown(self):
        """시스템 종료"""
        self.orchestrator.stop_all()
        self.session_pool.close_all()
        log("🔒 시스템 종료")


def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로 v2.0')
    parser.add_argument('--pre-login', action='store_true', help='사전 로그인만 실행')
    parser.add_argument('--test', action='store_true', help='즉시 테스트')
    parser.add_argument('--target', type=str, help='목표 시간 (HH:MM)')
    parser.add_argument('--goods', type=str, help='공연 ID')
    parser.add_argument('--schedule', type=str, default='', help='회차 ID')
    parser.add_argument('--seats', type=int, default=2, help='좌석 수')
    args = parser.parse_args()
    
    # 설정 로드
    config = SystemConfig.from_env()
    
    if args.goods:
        config.goods_id = args.goods
    if args.seats:
        config.seat_count = args.seats
    
    # 시스템 생성
    system = BTSTicketing(config)
    
    try:
        system.initialize()
        
        if args.pre_login:
            # 사전 로그인만
            system.pre_login()
            
        elif args.test:
            # 즉시 테스트
            if system.session_pool.valid_count == 0:
                log("⚠️ 유효한 세션 없음. 로그인 먼저...")
                system.pre_login()
            
            result = system.run_booking(args.schedule)
            if result:
                log(f"✅ 테스트 성공!")
            
        elif args.target:
            # 목표 시간 예매
            if system.session_pool.valid_count == 0:
                system.pre_login()
            
            if system.wait_for_target_time(args.target):
                system.run_booking(args.schedule)
        
        else:
            parser.print_help()
    
    except KeyboardInterrupt:
        log("⚠️ 사용자 중단")
    finally:
        system.shutdown()


if __name__ == '__main__':
    main()
