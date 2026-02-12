"""
세션 관리 - 사전 로그인 + 세션 풀
"""
import os
import json
import time
import httpx
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from threading import Lock
from pathlib import Path

@dataclass
class AuthSession:
    """인증된 세션"""
    account_id: str
    cookies: Dict[str, str] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    
    _http_client: Optional[httpx.Client] = field(default=None, repr=False)
    
    def is_expired(self, ttl: int = 3600) -> bool:
        """세션 만료 여부"""
        return time.time() - self.created_at > ttl
    
    def update_activity(self):
        """활동 시간 갱신"""
        self.last_active = time.time()
    
    @property
    def http_client(self) -> httpx.Client:
        """HTTP 클라이언트 (lazy init)"""
        if self._http_client is None:
            self._http_client = httpx.Client(
                cookies=self.cookies,
                headers=self.headers,
                timeout=10.0,
                follow_redirects=True
            )
        return self._http_client
    
    def close(self):
        """클라이언트 종료"""
        if self._http_client:
            self._http_client.close()
            self._http_client = None
    
    def to_dict(self) -> dict:
        """직렬화"""
        return {
            'account_id': self.account_id,
            'cookies': self.cookies,
            'headers': self.headers,
            'created_at': self.created_at,
            'last_active': self.last_active
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "AuthSession":
        """역직렬화"""
        return cls(
            account_id=data['account_id'],
            cookies=data.get('cookies', {}),
            headers=data.get('headers', {}),
            created_at=data.get('created_at', time.time()),
            last_active=data.get('last_active', time.time())
        )


class SessionPool:
    """세션 풀 관리자"""
    
    def __init__(self, session_dir: str = "./sessions", ttl: int = 3600):
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.ttl = ttl
        self._sessions: Dict[str, AuthSession] = {}
        self._lock = Lock()
    
    def add(self, session: AuthSession) -> bool:
        """세션 추가"""
        with self._lock:
            self._sessions[session.account_id] = session
            self._save_session(session)
            return True
    
    def get(self, account_id: str) -> Optional[AuthSession]:
        """세션 조회"""
        with self._lock:
            session = self._sessions.get(account_id)
            if session and not session.is_expired(self.ttl):
                return session
            
            # 파일에서 로드 시도
            loaded = self._load_session(account_id)
            if loaded and not loaded.is_expired(self.ttl):
                self._sessions[account_id] = loaded
                return loaded
            
            return None
    
    def get_all_valid(self) -> List[AuthSession]:
        """모든 유효한 세션"""
        with self._lock:
            valid = []
            for session in self._sessions.values():
                if not session.is_expired(self.ttl):
                    valid.append(session)
            return valid
    
    def remove(self, account_id: str):
        """세션 제거"""
        with self._lock:
            if account_id in self._sessions:
                self._sessions[account_id].close()
                del self._sessions[account_id]
            
            filepath = self.session_dir / f"{account_id}.json"
            if filepath.exists():
                filepath.unlink()
    
    def _save_session(self, session: AuthSession):
        """세션 파일 저장"""
        filepath = self.session_dir / f"{session.account_id}.json"
        with open(filepath, 'w') as f:
            json.dump(session.to_dict(), f)
    
    def _load_session(self, account_id: str) -> Optional[AuthSession]:
        """세션 파일 로드"""
        filepath = self.session_dir / f"{account_id}.json"
        if not filepath.exists():
            return None
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            return AuthSession.from_dict(data)
        except Exception:
            return None
    
    def load_all(self):
        """모든 저장된 세션 로드"""
        for filepath in self.session_dir.glob("*.json"):
            account_id = filepath.stem
            session = self._load_session(account_id)
            if session and not session.is_expired(self.ttl):
                self._sessions[account_id] = session
    
    def close_all(self):
        """모든 세션 종료"""
        with self._lock:
            for session in self._sessions.values():
                session.close()
            self._sessions.clear()
    
    @property
    def count(self) -> int:
        """세션 수"""
        return len(self._sessions)
    
    @property
    def valid_count(self) -> int:
        """유효한 세션 수"""
        return len(self.get_all_valid())
