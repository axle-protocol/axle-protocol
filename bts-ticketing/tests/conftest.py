#!/usr/bin/env python3
"""
Pytest 설정 및 공통 fixture
"""

import pytest
import os
import sys
from unittest.mock import MagicMock, AsyncMock

# 테스트 대상 모듈 경로
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))


@pytest.fixture
def mock_driver():
    """Selenium WebDriver Mock"""
    driver = MagicMock()
    driver.find_element.return_value = MagicMock()
    driver.window_handles = ['tab1', 'tab2']
    return driver


@pytest.fixture
def mock_nodriver_browser():
    """Nodriver Browser Mock"""
    browser = AsyncMock()
    browser.get.return_value = AsyncMock()
    return browser


@pytest.fixture
def mock_config():
    """테스트용 설정"""
    return {
        'USER_ID': 'test_user',
        'USER_PWD': 'test_pass',
        'CONCERT_URL': 'https://tickets.interpark.com/goods/12345',
        'TELEGRAM_BOT_TOKEN': 'test_token',
        'TELEGRAM_CHAT_ID': 'test_chat',
    }


@pytest.fixture
def mock_requests():
    """requests 모듈 Mock"""
    with pytest.importorskip('unittest.mock').patch('requests.post') as mock:
        mock.return_value.status_code = 200
        yield mock
