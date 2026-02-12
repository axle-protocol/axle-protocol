"""
시스템 설정
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional
import os
from dotenv import load_dotenv

load_dotenv('.env.local')
load_dotenv('../.env.local')
load_dotenv('../../.env.local')

@dataclass
class Account:
    """계정 정보"""
    id: str
    password: str
    name: str = ""

@dataclass
class SystemConfig:
    """시스템 설정"""
    # 계정 목록
    accounts: List[Account] = field(default_factory=list)
    
    # 타겟 공연
    goods_id: str = ""
    target_date: str = ""  # YYYY-MM-DD
    target_time: str = ""  # HH:MM
    
    # 좌석 설정
    seat_count: int = 2
    prefer_consecutive: bool = True
    prefer_zones: List[str] = field(default_factory=list)  # ["VIP", "R", "S"]
    
    # 결제 설정
    payment_method: str = "kakaopay"  # kakaopay, toss, card
    auto_payment: bool = True
    
    # 성능 설정
    max_workers: int = 10
    request_timeout: float = 5.0
    retry_count: int = 3
    
    # 세션 설정
    session_dir: str = "./sessions"
    session_ttl: int = 3600  # 1시간
    
    @classmethod
    def from_env(cls) -> "SystemConfig":
        """환경변수에서 설정 로드"""
        config = cls()
        
        # 기본 계정 (환경변수)
        if os.getenv('INTERPARK_ID') and os.getenv('INTERPARK_PWD'):
            config.accounts.append(Account(
                id=os.getenv('INTERPARK_ID', ''),
                password=os.getenv('INTERPARK_PWD', ''),
                name='primary'
            ))
        
        config.goods_id = os.getenv('CONCERT_URL', '').split('/')[-1]
        config.payment_method = os.getenv('PAYMENT_METHOD', 'kakaopay')
        
        return config
    
    def add_account(self, id: str, password: str, name: str = ""):
        """계정 추가"""
        self.accounts.append(Account(id=id, password=password, name=name or f"account_{len(self.accounts)}"))
