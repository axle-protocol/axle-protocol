# BTS 티켓팅 버그 수정 로그

## 2026-02-10 - Critical 버그 수정 #1

**수정 파일:**
- `src/main_camoufox.py`
- `src/config.py`

**QA-REPORT.md 기반 수정 내역:**

---

### C1. 로그인 성공 확인 로직 추가 ✅

**문제:** `login()` 함수가 항상 `True` 반환. 실제 로그인 성공 여부를 확인하지 않음.

**수정 내용:**
- 로그인 버튼 클릭 시 try-except로 오류 처리 추가
- 로그인 폼 입력 시 try-except로 오류 처리 추가
- 로그인 성공 확인: 마이페이지/로그아웃 버튼 존재 여부 확인 (10초 타임아웃)
- 실패 시 텔레그램 알림 + `False` 반환

```python
# 로그인 성공 확인 (마이페이지 버튼 또는 사용자 메뉴 존재 여부)
try:
    success_indicator = page.locator('text=마이페이지, text=로그아웃, a[href*="mypage"]').first
    await success_indicator.wait_for(state='visible', timeout=10000)
    print("✅ 로그인 완료")
    return True
except Exception as e:
    print(f"❌ 로그인 실패: 자격증명을 확인하세요. ({e})")
    await send_telegram("❌ 로그인 실패: 자격증명을 확인하세요.")
    return False
```

---

### C2. except: pass → 구체적 에러 처리 ✅

**문제:** `except: pass` 또는 `except Exception:` 후 로깅 없이 진행

**수정 내용:**

1. **`login()`**: 
   - 로그인 버튼 클릭 실패 → 에러 로깅 + 텔레그램 알림
   - 폼 입력 실패 → 에러 로깅 + 텔레그램 알림

2. **`click_booking()`**:
   - `TimeoutError` 분리 처리
   - 모든 시도에서 에러 타입과 메시지 출력
   - 10회 실패 시 텔레그램 알림

3. **`handle_captcha()`**:
   - iframe 접근 실패 → 별도 처리
   - 이미지 추출 실패 → 별도 처리 + 수동 입력 요청
   - 입력 필드 접근 실패 → 에러 로깅
   - 에러 타입 명시: `{type(e).__name__}: {e}`

4. **`select_seat()`**:
   - iframe 접근 실패 → 별도 처리
   - `TimeoutError` 분리 처리
   - 새로고침 버튼 실패 → 에러 로깅 (무시하지 않음)

---

### C4. 빈 자격증명 검증 ✅

**문제:** `USER_ID`, `USER_PWD`가 빈 문자열이어도 실행됨

**수정 내용 (config.py):**
```python
# C4: 빈 자격증명 검증
if not cfg.interpark.user_id:
    errors.append("INTERPARK_ID 환경 변수 필요")
if not cfg.interpark.user_id.strip():
    errors.append("INTERPARK_ID가 비어 있습니다")
if not cfg.interpark.user_pwd:
    errors.append("INTERPARK_PWD 환경 변수 필요")
if not cfg.interpark.user_pwd.strip():
    errors.append("INTERPARK_PWD가 비어 있습니다")
```

---

### C5. CONCERT_URL 검증 ✅

**문제:** `'https://tickets.interpark.com/goods/XXXXXXX'` 하드코딩된 플레이스홀더

**수정 내용 (config.py):**
```python
# C5: CONCERT_URL 플레이스홀더 검증
if 'XXXXXXX' in cfg.interpark.concert_url:
    errors.append("CONCERT_URL에 실제 공연 URL을 설정하세요 (현재: 플레이스홀더 'XXXXXXX')")
if not cfg.interpark.concert_url.startswith('https://tickets.interpark.com/'):
    errors.append("CONCERT_URL은 'https://tickets.interpark.com/'으로 시작해야 합니다")
```

---

### 추가 수정: run() 함수 로직 흐름 개선 ✅

**문제:** 각 단계 실패 시에도 다음 단계로 계속 진행

**수정 내용:**
```python
# 로그인 (실패 시 중단)
if not await login(page):
    print("\n❌ 로그인 실패로 종료합니다.")
    return

# 예매 버튼 클릭 (실패 시 중단)
success, new_page = await click_booking(page)
if not success:
    print("\n❌ 예매 버튼 클릭 실패로 종료합니다.")
    return

# CAPTCHA 처리 (실패 시 중단)
if not await handle_captcha(page):
    print("\n❌ CAPTCHA 처리 실패로 종료합니다.")
    return
```

---

## 요약

| 버그 ID | 설명 | 상태 |
|---------|------|------|
| C1 | 로그인 성공 확인 로직 | ✅ 수정됨 |
| C2 | except: pass → 구체적 에러 처리 | ✅ 수정됨 |
| C4 | 빈 자격증명 검증 | ✅ 수정됨 |
| C5 | CONCERT_URL 검증 | ✅ 수정됨 |

**남은 Critical 버그 (별도 수정 필요):**
- C3: iframe 전환 실패 시 crash
- C6: Nodriver - 로그인 실패 시 계속 진행 (main_nodriver.py)
- C7: CAPTCHA 타임아웃 하드코딩
- C8: Nodriver - browser.stop() 메서드 확인 (main_nodriver.py)

---

*수정 완료: 2026-02-10 20:37 KST*
