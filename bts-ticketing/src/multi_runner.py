#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - 멀티 인스턴스 러너
여러 브라우저를 병렬로 실행하여 티켓팅 성공률 향상

Features:
- 설정된 인스턴스 수만큼 병렬 실행
- 각 인스턴스에 다른 프록시 할당
- 각 인스턴스에 다른 계정 할당
- 중앙 로깅 (하나의 파일에 모든 인스턴스 로그)
- 성공 시 즉시 다른 인스턴스 중단
- 텔레그램 알림

Usage:
    python multi_runner.py --test      # 테스트 모드
    python multi_runner.py --live      # 실전 모드
    python multi_runner.py --instances 5  # 인스턴스 수 지정
"""

import asyncio
import argparse
import logging
import signal
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
import httpx

from config import (
    Config, load_config, validate_config,
    AccountConfig, ProxyEntry, MultiInstanceConfig
)

# ============ 글로벌 상태 (스레드 안전) ============

@dataclass
class RunnerState:
    """멀티 러너 전역 상태 (원자적 연산 지원)"""
    success_event: asyncio.Event = None
    shutdown_event: asyncio.Event = None
    winner_instance: Optional[int] = None
    active_tasks: Dict[int, asyncio.Task] = None
    results: Dict[int, str] = None  # 인스턴스별 결과
    _lock: asyncio.Lock = None  # 상태 변경 락
    
    def __post_init__(self):
        """Lock 초기화 (dataclass 호환)"""
        if self._lock is None:
            self._lock = asyncio.Lock()
    
    async def claim_victory(self, instance_id: int) -> bool:
        """원자적으로 승리 선언 - 먼저 호출한 인스턴스만 True 반환"""
        if self._lock is None:
            self._lock = asyncio.Lock()
        
        async with self._lock:
            if self.winner_instance is None:
                self.winner_instance = instance_id
                if self.success_event:
                    self.success_event.set()
                if self.shutdown_event:
                    self.shutdown_event.set()
                return True
            return False  # 이미 다른 인스턴스가 승리
    
    async def record_result(self, instance_id: int, result: str):
        """결과 기록 (스레드 안전)"""
        if self._lock is None:
            self._lock = asyncio.Lock()
        
        async with self._lock:
            if self.results is None:
                self.results = {}
            self.results[instance_id] = result


state = RunnerState()


# ============ 중앙 로깅 설정 ============

class InstanceFormatter(logging.Formatter):
    """인스턴스 ID를 포함하는 로그 포매터"""
    
    def format(self, record):
        if not hasattr(record, 'instance_id'):
            record.instance_id = 'MAIN'
        return super().format(record)


def setup_logging(log_file: str) -> logging.Logger:
    """중앙 로깅 설정"""
    # 로그 디렉토리 생성
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    # 로거 생성
    logger = logging.getLogger('multi_runner')
    logger.setLevel(logging.DEBUG)
    
    # 파일 핸들러 (모든 인스턴스 로그)
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)
    file_formatter = InstanceFormatter(
        '%(asctime)s [%(instance_id)s] %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(file_formatter)
    
    # 콘솔 핸들러
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = InstanceFormatter(
        '%(asctime)s [%(instance_id)s] %(message)s',
        datefmt='%H:%M:%S'
    )
    console_handler.setFormatter(console_formatter)
    
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


def get_instance_logger(logger: logging.Logger, instance_id: int) -> logging.LoggerAdapter:
    """인스턴스별 로거 어댑터 생성"""
    return logging.LoggerAdapter(logger, {'instance_id': f'#{instance_id:02d}'})


# ============ 텔레그램 알림 ============

async def send_telegram(config: Config, message: str, silent: bool = False) -> None:
    """텔레그램 알림 전송"""
    cfg = config.telegram
    if not cfg.enabled or not cfg.bot_token:
        return
    
    url = f"https://api.telegram.org/bot{cfg.bot_token}/sendMessage"
    data = {
        'chat_id': cfg.chat_id,
        'text': f"🎫 BTS 티켓팅 (멀티)\n{message}",
        'parse_mode': 'HTML',
        'disable_notification': silent
    }
    
    try:
        async with httpx.AsyncClient() as client:
            await client.post(url, data=data, timeout=5)
    except Exception:
        pass


# ============ 인스턴스 실행 ============

async def run_instance(
    instance_id: int,
    config: Config,
    account: AccountConfig,
    proxy: Optional[ProxyEntry],
    logger: logging.LoggerAdapter,
    test_mode: bool = False
) -> bool:
    """단일 인스턴스 실행
    
    Returns:
        bool: 성공 여부
    """
    # 동적 import (순환 참조 방지)
    from main_camoufox import (
        init_browser, login, navigate_to_concert,
        wait_for_open, click_booking, handle_captcha, select_seat
    )
    
    logger.info(f"인스턴스 시작 - 계정: {account.name or account.user_id[:4]}***")
    
    if proxy:
        logger.info(f"프록시: {proxy.name or proxy.server}")
    else:
        logger.info("프록시: 없음 (직접 연결)")
    
    browser = None
    
    try:
        # 설정 복제 및 오버라이드
        instance_config = Config(
            proxy=config.proxy,
            captcha=config.captcha,
            telegram=config.telegram,
            browser=config.browser,
            human=config.human,
            interpark=config.interpark,
            multi=config.multi,
            debug=config.debug,
            max_retries=config.max_retries
        )
        
        # 계정 오버라이드
        instance_config.interpark.user_id = account.user_id
        instance_config.interpark.user_pwd = account.user_pwd
        
        # 프록시 오버라이드
        if proxy:
            instance_config.proxy.enabled = True
            instance_config.proxy.server = proxy.server
            instance_config.proxy.username = proxy.username
            instance_config.proxy.password = proxy.password
        else:
            instance_config.proxy.enabled = False
        
        # 전역 config 대체 (main_camoufox 모듈용)
        import main_camoufox
        main_camoufox.config = instance_config
        
        # 브라우저 시작
        browser, page = await init_browser()
        logger.info("브라우저 초기화 완료")
        
        # 성공/종료 이벤트 체크 루프
        async def check_events():
            while True:
                if state.shutdown_event.is_set():
                    raise asyncio.CancelledError("다른 인스턴스 성공으로 종료")
                await asyncio.sleep(0.5)
        
        check_task = asyncio.create_task(check_events())
        
        try:
            # 로그인
            await login(page)
            logger.info("로그인 완료")
            
            # 공연 페이지 이동
            await navigate_to_concert(page)
            logger.info("공연 페이지 도착")
            
            # 오픈 대기 (테스트 모드에서는 생략)
            if not test_mode:
                await wait_for_open(page)
                logger.info("오픈 시간!")
            
            # 예매 버튼 클릭
            result = await click_booking(page)
            if isinstance(result, tuple):
                success, new_page = result
                if hasattr(new_page, 'url'):
                    page = new_page
            logger.info("예매 창 열림")
            
            # CAPTCHA 처리
            await handle_captcha(page)
            logger.info("CAPTCHA 처리 완료")
            
            # 좌석 선택
            if await select_seat(page):
                logger.info("🎉 좌석 선택 성공!")
                
                # 성공 알림
                state.winner_instance = instance_id
                state.success_event.set()
                state.shutdown_event.set()
                
                return True
            else:
                logger.warning("좌석 선택 실패 (매진)")
                return False
                
        finally:
            check_task.cancel()
            try:
                await check_task
            except asyncio.CancelledError:
                pass
    
    except asyncio.CancelledError:
        logger.info("종료됨 (다른 인스턴스 성공)")
        return False
    
    except Exception as e:
        logger.error(f"오류: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return False
    
    finally:
        if browser:
            try:
                await browser.__aexit__(None, None, None)
                logger.debug("브라우저 종료됨")
            except Exception:
                pass


# ============ 멀티 러너 ============

async def run_multi(config: Config, test_mode: bool = False) -> bool:
    """멀티 인스턴스 실행"""
    multi_cfg = config.multi
    
    # 로깅 설정
    logger = setup_logging(multi_cfg.log_file)
    main_log = logging.LoggerAdapter(logger, {'instance_id': 'MAIN'})
    
    main_log.info("=" * 60)
    main_log.info("BTS 티켓팅 멀티 러너 시작")
    main_log.info(f"인스턴스 수: {multi_cfg.instance_count}")
    main_log.info(f"등록된 계정: {len(multi_cfg.accounts)}개")
    main_log.info(f"등록된 프록시: {len(multi_cfg.proxies)}개")
    main_log.info(f"오픈 시간: {config.interpark.open_time}")
    main_log.info("=" * 60)
    
    # 상태 초기화
    state.success_event = asyncio.Event()
    state.shutdown_event = asyncio.Event()
    state.winner_instance = None
    state.active_tasks = {}
    state.results = {}
    
    # 계정/프록시 검증
    if len(multi_cfg.accounts) < multi_cfg.instance_count:
        main_log.warning(
            f"계정 수({len(multi_cfg.accounts)})가 인스턴스 수({multi_cfg.instance_count})보다 적음"
        )
        # 계정 순환 사용
    
    if len(multi_cfg.proxies) < multi_cfg.instance_count:
        main_log.warning(
            f"프록시 수({len(multi_cfg.proxies)})가 인스턴스 수({multi_cfg.instance_count})보다 적음"
        )
        # 프록시 순환 사용 또는 직접 연결
    
    # 텔레그램 알림
    await send_telegram(
        config,
        f"🚀 멀티 러너 시작\n"
        f"인스턴스: {multi_cfg.instance_count}개\n"
        f"오픈: {config.interpark.open_time.strftime('%H:%M:%S')}"
    )
    
    # 인스턴스 태스크 생성
    tasks = []
    
    for i in range(multi_cfg.instance_count):
        # 계정 할당 (순환)
        account_idx = i % len(multi_cfg.accounts) if multi_cfg.accounts else 0
        account = multi_cfg.accounts[account_idx] if multi_cfg.accounts else AccountConfig(
            user_id=config.interpark.user_id,
            user_pwd=config.interpark.user_pwd,
            name="default"
        )
        
        # 프록시 할당 (순환, 없으면 None)
        proxy = None
        if multi_cfg.proxies:
            proxy_idx = i % len(multi_cfg.proxies)
            proxy = multi_cfg.proxies[proxy_idx]
        
        # 인스턴스 로거
        inst_logger = get_instance_logger(logger, i + 1)
        
        # 태스크 생성 (스태거링 딜레이 포함)
        async def run_with_delay(idx, acc, prx, log):
            if idx > 0 and multi_cfg.stagger_delay > 0:
                await asyncio.sleep(idx * multi_cfg.stagger_delay)
            return await run_instance(idx + 1, config, acc, prx, log, test_mode)
        
        task = asyncio.create_task(
            run_with_delay(i, account, proxy, inst_logger),
            name=f"instance-{i+1}"
        )
        tasks.append(task)
        state.active_tasks[i + 1] = task
    
    main_log.info(f"{len(tasks)}개 인스턴스 시작됨")
    
    # 결과 수집
    try:
        # 첫 번째 성공 또는 모든 완료 대기
        done, pending = await asyncio.wait(
            tasks,
            timeout=multi_cfg.instance_timeout if multi_cfg.instance_timeout > 0 else None,
            return_when=asyncio.FIRST_COMPLETED if multi_cfg.stop_on_success else asyncio.ALL_COMPLETED
        )
        
        # 성공 체크
        success = False
        for task in done:
            try:
                result = task.result()
                if result:
                    success = True
                    break
            except Exception:
                pass
        
        # 성공 시 나머지 태스크 취소
        if success and multi_cfg.stop_on_success and pending:
            main_log.info(f"성공! {len(pending)}개 인스턴스 중단 중...")
            state.shutdown_event.set()
            
            for task in pending:
                task.cancel()
            
            # 취소 완료 대기
            await asyncio.gather(*pending, return_exceptions=True)
        
        # 결과 정리
        success_count = sum(1 for t in done if not t.cancelled() and t.result())
        fail_count = len(done) - success_count
        cancelled_count = len(pending) + sum(1 for t in done if t.cancelled())
        
        main_log.info("=" * 60)
        main_log.info("실행 완료")
        main_log.info(f"성공: {success_count}, 실패: {fail_count}, 취소: {cancelled_count}")
        
        if state.winner_instance:
            main_log.info(f"🏆 우승 인스턴스: #{state.winner_instance:02d}")
            await send_telegram(
                config,
                f"🎉 티켓팅 성공!\n"
                f"우승 인스턴스: #{state.winner_instance}\n"
                f"결제를 진행하세요!"
            )
        else:
            await send_telegram(config, f"❌ 모든 인스턴스 실패\n성공: {success_count}")
        
        main_log.info("=" * 60)
        
        return success
        
    except asyncio.TimeoutError:
        main_log.error(f"타임아웃 ({multi_cfg.instance_timeout}초)")
        state.shutdown_event.set()
        
        for task in tasks:
            task.cancel()
        
        await asyncio.gather(*tasks, return_exceptions=True)
        
        await send_telegram(config, "❌ 타임아웃으로 종료")
        return False


# ============ 시그널 핸들러 ============

def setup_signal_handlers():
    """시그널 핸들러 설정 (Ctrl+C 등)"""
    def signal_handler(sig, frame):
        print("\n\n⚠️ 종료 신호 수신, 모든 인스턴스 중단 중...")
        if state.shutdown_event:
            state.shutdown_event.set()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


# ============ 샘플 설정 로더 ============

def load_sample_config(config: Config) -> Config:
    """샘플 멀티 인스턴스 설정 로드 (테스트용)
    
    실제 사용 시 .env.local 또는 별도 설정 파일에서 로드
    """
    import os
    
    # 환경 변수에서 멀티 계정 로드
    # 형식: ACCOUNT_1_ID, ACCOUNT_1_PWD, ACCOUNT_2_ID, ...
    accounts = []
    for i in range(1, 10):
        user_id = os.getenv(f'ACCOUNT_{i}_ID', '')
        user_pwd = os.getenv(f'ACCOUNT_{i}_PWD', '')
        if user_id and user_pwd:
            accounts.append(AccountConfig(
                user_id=user_id,
                user_pwd=user_pwd,
                name=f"계정{i}"
            ))
    
    # 기본 계정이 없으면 단일 계정 사용
    if not accounts and config.interpark.user_id:
        accounts.append(AccountConfig(
            user_id=config.interpark.user_id,
            user_pwd=config.interpark.user_pwd,
            name="기본"
        ))
    
    # 환경 변수에서 멀티 프록시 로드
    # 형식: PROXY_1_SERVER, PROXY_1_USER, PROXY_1_PASS, ...
    proxies = []
    for i in range(1, 10):
        server = os.getenv(f'PROXY_{i}_SERVER', '')
        username = os.getenv(f'PROXY_{i}_USER', '')
        password = os.getenv(f'PROXY_{i}_PASS', '')
        if server and username:
            proxies.append(ProxyEntry(
                server=server,
                username=username,
                password=password,
                name=f"프록시{i}"
            ))
    
    # 기본 프록시가 없으면 단일 프록시 사용
    if not proxies and config.proxy.enabled and config.proxy.username:
        proxies.append(ProxyEntry(
            server=config.proxy.server,
            username=config.proxy.username,
            password=config.proxy.password,
            name="기본"
        ))
    
    # 멀티 인스턴스 설정
    config.multi.enabled = True
    config.multi.accounts = accounts
    config.multi.proxies = proxies
    
    return config


# ============ 메인 ============

def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 멀티 러너')
    parser.add_argument('--test', action='store_true', help='테스트 모드 (오픈 대기 생략)')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    parser.add_argument('--instances', type=int, default=3, help='인스턴스 수 (기본: 3)')
    parser.add_argument('--env', type=str, default='.env.local', help='환경 변수 파일')
    parser.add_argument('--log', type=str, default='logs/multi_runner.log', help='로그 파일')
    parser.add_argument('--stagger', type=float, default=0.5, help='인스턴스 시작 딜레이 (초)')
    parser.add_argument('--timeout', type=int, default=300, help='타임아웃 (초, 0=무제한)')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법:")
        print("  python multi_runner.py --test         # 테스트 모드")
        print("  python multi_runner.py --live         # 실전 모드")
        print("  python multi_runner.py --test --instances 5  # 5개 인스턴스")
        print()
        print("환경 변수 (.env.local):")
        print("  ACCOUNT_1_ID, ACCOUNT_1_PWD    # 계정 1")
        print("  ACCOUNT_2_ID, ACCOUNT_2_PWD    # 계정 2")
        print("  PROXY_1_SERVER, PROXY_1_USER, PROXY_1_PASS  # 프록시 1")
        return
    
    # 시그널 핸들러 설정
    setup_signal_handlers()
    
    print("🎫 BTS 티켓팅 멀티 러너")
    print("=" * 50)
    
    # 설정 로드
    config = load_config(args.env)
    config = load_sample_config(config)  # 멀티 설정 추가
    
    # 인스턴스 설정 오버라이드
    config.multi.instance_count = args.instances
    config.multi.log_file = args.log
    config.multi.stagger_delay = args.stagger
    config.multi.instance_timeout = args.timeout
    
    print(f"인스턴스 수: {config.multi.instance_count}")
    print(f"계정 수: {len(config.multi.accounts)}")
    print(f"프록시 수: {len(config.multi.proxies)}")
    print(f"로그 파일: {config.multi.log_file}")
    print("=" * 50)
    
    # 설정 검증
    errors = validate_config(config)
    if errors:
        print("❌ 설정 오류:")
        for err in errors:
            print(f"  - {err}")
        return
    
    # 계정 검증
    if not config.multi.accounts:
        print("❌ 계정이 설정되지 않았습니다.")
        print("   .env.local에 ACCOUNT_1_ID, ACCOUNT_1_PWD 설정 필요")
        return
    
    # 실행
    try:
        success = asyncio.run(run_multi(config, test_mode=args.test))
        
        if success:
            print("\n🎉 티켓팅 성공!")
            print("결제 화면에서 직접 결제해주세요!")
            input("\n결제 완료 후 Enter를 눌러주세요...")
        else:
            print("\n❌ 티켓팅 실패")
            
    except KeyboardInterrupt:
        print("\n\n⚠️ 사용자 취소")
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
