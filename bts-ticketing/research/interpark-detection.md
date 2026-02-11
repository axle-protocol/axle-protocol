# 인터파크/NOL 티켓 봇 감지 시스템 분석

> 최종 업데이트: 2026-02-10
> ⚠️ 웹 검색 기반 정보만 포함. 각 항목에 출처 URL 명시.

---

## 1. 봇 감지 및 계정 정지

### 1.1 E_02 에러코드 (IP밴)

> "1초 안에 클릭 5회가 넘어갈경우 인터파크측에서는 이를 매크로로 간주하여 IP밴을 할 수 있습니다. 이 경우 한시간 정지라는 후기가 많으며 만약 본인이 매크로를 쓰지 않았다면 인터파크 측에 소명하여 정지를 해제할 수도 있다고 합니다."

**출처**: https://yozmaedle.tistory.com/entry/인터파크-에러코드-E02-block-아이피밴-ip밴-1시간-정지-영구정지-차이

### 1.2 매크로 적발 시 처벌

> "최초 걸리면 티켓취소+아이디 30일 정지입니다. 보통 사전에 다 취소되기 때문에 현장에서 취소되는 사례는 거의 없긴 하나 모니터링 후 공연 전날이라도 티켓이 취소되는 사례도 있었습니다."

**출처**: https://m.kin.naver.com/qna/dirs/30215/docs/475870104

### 1.3 Selenium 감지

> "반복적으로 사용시, 매크로로 감지하여 정지먹음 주의"
> "셀레늄 감지 방지 코드 (요소가 클릭이 안될때 아래 코드를 추가하여 셀레늄 감지를 피할 수 있다)"

**출처**: https://spectrum20.tistory.com/entry/python-Selenium-활용-인터파크-티켓예매-매크로-만들기

### 1.4 소명서 제출 방법

> "NOL 티켓 고객센터 메일 (ticket_cs@nol-universe.com) 발송 후 대표번호 1544-1555 연락해 주세요"

**출처**: https://help.interpark.com/ticket/faq?category=TICKET_TICKET

---

## 2. 안심예매 보안문자

### 2.1 OCR 자동 인식

> "매크로 프로그램을 깔면 그 프로그램이 자동으로 보안문자를 인식해 입력하는데 1, 2초도 걸리지 않는다"

**출처**: https://www.dailian.co.kr/news/view/1245119/ (2023.06.21)

### 2.2 보안문자 매크로 존재

> "매크로 실행하면 예매 시 뜨는 이 창의 '문자를 입력해주세요' 칸에 자동으로 보안문자를 입력해줍니다"

**출처**: https://www.postype.com/@pompomticket/post/16833935

### 2.3 EasyOCR 활용

> "pip install easyocr (부정예매 방지 문자 입력용 OCR 모듈)"

**출처**: https://spectrum20.tistory.com/entry/python-Selenium-활용-인터파크-티켓예매-매크로-만들기

---

## 3. 얼굴인식 티켓팅 (얼굴패스)

### 3.1 서비스 런칭

> "TWS의 이번 공연은 티켓, 신분증 확인 절차 없이 안면인식 장비가 설치된 게이트를 통과하는 것만으로 관람객 입장이 가능하다."

**출처**: https://www.newstap.co.kr/news/articleView.html?idxno=231082 (2024.12.23)

### 3.2 하이브+토스+인터파크 MOU

> "인터파크트리플은 지난 12일 서울 강남구 역삼동 비바리퍼블리카(이하 토스) 본사에서 토스, 하이브와 얼굴인증 암표방지 솔루션 관련 업무협약(MOU)를 체결했다고 밝혔다."

**출처**: https://www.economidaily.com/view/20240813080109077 (2024.08.12)

### 3.3 기술 방식

> "등록된 얼굴 정보는 사진 파일이 아닌 암호화된 패턴 정보로 저장·관리되며 저장된 얼굴 패턴 정보는 공연 입장을 위한 본인확인 용도 외에는 사용되지 않는다"

**출처**: https://www.yna.co.kr/view/AKR20241223099900030 (2024.12.23)

### 3.4 지문/정맥 대신 얼굴 선택 이유

> "지문이나 정맥 인증 절차도 검토했지만 별도의 장비를 통해 등록해야 하고 NFT 티켓 양도처럼 지문·정맥 등록 기기를 주면 아무 소용이 없다고 봤다"

**출처**: https://economychosun.com/site/data/html_dir/2025/01/17/2025011700016.html (2025.01.17)

---

## 4. 새로고침 정책

### 4.1 카운트다운 방식

> "인터파크는 예매 버튼에 카운트다운이 되기때문에 새고 굳이 안하셔도 됩니다 카운트다운 다되면 바로 예매 열려요"

**출처**: https://m.kin.naver.com/qna/dirs/51001/docs/471555261

### 4.2 과도한 새로고침 위험

> "너무 자주 새로고침 하면 오히려 차단되거나, 서버에서 밀려날 수도 있죠"

**출처**: https://health.solbangwulwebsite.com/entry/필독-인터파크-취켓팅-성공-확률-높이는-방법-새로고침-최적화-공략 (2025.02.17)

### 4.3 동시접속 제한

> "2024년 8월 전까지는 PC와 모바일에서 인터파크 티켓 동시접속 후 예매를 할 수 있었지만 지금은 아닙니다."

**출처**: https://moneyconnet.com/2299 (2024.11.20)

---

## 5. Selenium 감지 우회 (기술 참고)

### 5.1 selenium-stealth

> "셀레늄 스텔스를 모듈을 사용하여 기존 코드에 아래 코드를 추가해주기만 하면, 셀레늄 감지를 피할 수 있다"

**출처**: https://spectrum20.tistory.com/entry/python-selenium-stealth-셀레늄-감지-방지-구글-크롬 (2025.04.19)

### 5.2 Chrome 디버깅 모드

> "크롬을 디버깅 모드로 열어서 debugging port를 열고, 해당 포트에 접속해 크롬을 제어할 수 있다"

**출처**: https://yoonminlee.com/selenium-bot-detection-bypass

### 5.3 프록시 서버 활용

> "프록시 서버를 사용하여 셀레니움과 웹 사이트 사이에 중계 서버를 두어 자동화 감지를 우회할 수 있습니다"

**출처**: https://wise-office-worker.tistory.com/40 (2025.06.21)

---

## 6. 예매버튼 활성화 (직링)

### 6.1 2024.09 이후 상황

> "요즘 인터파크 티켓팅 꼼수 다 막히고 어렵다던데... 본 포스트는 240910(자동호출 막힘 이슈) 서버 개편 이후부터 사용 가능한 1. 예매버튼 활성화 방법, 2. 인터파크 호출코드 세팅 방법 등을 포함"

**출처**: https://www.postype.com/@damgom00/post/17657210 (2025.10.13)

### 6.2 스포츠 티켓 자동호출

> "인터파크 스포츠에서 티켓 오픈 시간이 되지 않아도 미리 예매하기 버튼 활성화 시키는 방법입니다"

**출처**: https://www.postype.com/@kkstep/post/17855697 (2025.11.02)

---

## 7. 확인 필요 사항

| 항목 | 상태 |
|------|------|
| BTS 광화문 공연 얼굴패스 적용 여부 | ❓ 확인 필요 (공식 발표 없음) |
| 2026년 현재 봇 감지 최신 업데이트 | ❓ 확인 필요 |
| 영구정지 해제 가능 여부 | ❓ 확인 필요 |
| 모바일 앱 vs PC 감지 차이 | ❓ 확인 필요 |

---

## 요약

| 항목 | 출처 기반 사실 |
|------|---------------|
| IP밴 | 1초 5회+ 클릭 시 발생, 1시간 해제 (출처 있음) |
| 계정 정지 | 최초 30일, 티켓 취소 (출처 있음) |
| 보안문자 | OCR로 1-2초 우회 가능 (인터파크 인정) |
| 얼굴패스 | 2024.12 런칭, 하이브 MOU 체결 (출처 있음) |
| 동시접속 | 2024.08부터 PC+모바일 동시 불가 (출처 있음) |
| 새로고침 | 카운트다운 방식, 과도 시 차단 위험 (출처 있음) |

---

## 출처 목록

1. https://yozmaedle.tistory.com/entry/인터파크-에러코드-E02-block
2. https://m.kin.naver.com/qna/dirs/30215/docs/475870104
3. https://spectrum20.tistory.com/entry/python-Selenium-활용-인터파크-티켓예매-매크로-만들기
4. https://help.interpark.com/ticket/faq?category=TICKET_TICKET
5. https://www.dailian.co.kr/news/view/1245119/
6. https://www.newstap.co.kr/news/articleView.html?idxno=231082
7. https://www.economidaily.com/view/20240813080109077
8. https://www.yna.co.kr/view/AKR20241223099900030
9. https://economychosun.com/site/data/html_dir/2025/01/17/2025011700016.html
10. https://moneyconnet.com/2299
11. https://yoonminlee.com/selenium-bot-detection-bypass
12. https://www.postype.com/@damgom00/post/17657210
