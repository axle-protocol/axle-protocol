# 프록시 서비스 심층 비교 (BTS 광화문 티켓팅용)

> 조사일: 2026-02-10  
> 목적: BTS 콘서트 티켓팅에 적합한 프록시 서비스 선정  
> ⚠️ 모든 정보는 웹 검색 기준이며, 실제 구매 전 공식 사이트에서 재확인 필요

---

## 📊 요약 비교표

| 항목 | IPRoyal | Smartproxy (Decodo) | SOAX | Bright Data |
|------|---------|---------------------|------|-------------|
| **주거용 가격** | $7/GB | $2~3.5/GB | $2.46~3.6/GB | $3~4/GB (할인 후) |
| **최소 구매** | 없음 | $4 (2GB) | $90 (25GB) | 없음 (PAYG) |
| **한국 IP 수** | 66,728+ | ⚠️ 확인 필요 | 136,320+ | ⚠️ 확인 필요 |
| **무료 체험** | ❌ | ✅ 3일 100MB | ✅ $1.99/3일/400MB | ✅ |

---

## 1. 가격 상세 비교

### IPRoyal
**출처:** https://iproyal.com/pricing/residential-proxies/

- 주거용 프록시: **$7/GB** (벌크 구매시 최저 $1.75/GB)
- ISP 프록시: $2.40/IP/월
- 데이터센터: $1.39/IP
- **"ZERO monthly minimum and no long-term contracts"** - 공식 사이트

### Smartproxy (Decodo)
**출처:** https://decodo.com/proxies/residential-proxies/pricing

실제 가격표 (할인코드 NOIDEA67 적용 기준):
- 2GB: **$4** ($2/GB)
- 8GB: **$14.5** ($1.8/GB)
- 25GB: **$42.9** ($1.7/GB)
- 100GB: **$148.5** ($1.5/GB)
- Pay-As-You-Go: **$3.5/GB**
- 무료 체험: 3일 100MB

### SOAX
**출처:** https://soax.com/pricing

통합 플랜 (모든 프록시 타입 포함):
- Starter (25GB): **$90/월** ($3.6/GB)
- Advanced (50GB): **$170/월** ($3.4/GB)
- Professional (300GB): **$740/월** ($2.46/GB)
- Business (800GB): **$1,600/월** ($2/GB)
- 체험: $1.99/3일/400MB

**출처:** https://www.pcmag.com/reviews/soax
> "Residential proxies start at $1 for 4GB"

### Bright Data
**출처:** https://brightdata.com/pricing/proxy-network/residential-proxies

- Pay-As-You-Go: **$8/GB** → 할인코드 RESIGB50 적용시 **$4/GB**
- 141GB 플랜: $499/월 ($3.5/GB)
- 332GB 플랜: $999/월 ($3/GB)
- 현재 프로모션: 첫 입금 100% 매칭 (최대 $500)

---

## 2. 한국 IP 지원 여부

### IPRoyal
**출처:** https://iproyal.com/proxies-by-location/asia/south-korea/

> "Our pool of **66,728** South Korean proxies is fast, reliable, and secure"

**출처:** https://iproyal.com/proxies-by-location/asia/south-korea/seoul/
> "Seoul proxy servers... with uptime higher than 99.9%"

### SOAX
**출처:** https://soax.com/proxies/locations/korea

> "Buy Korean Proxies - **136,320 IPs available**"
> "Navigate through Korea's dynamic social media landscape... KakaoStory, Naver, Instagram, and Twitter"

### Smartproxy (Decodo)
**출처:** https://decodo.com/proxies/list/asia/korea

- 한국 프록시 지원 확인됨
- ⚠️ 정확한 한국 IP 수량은 확인 필요

### Bright Data
**출처:** https://brightdata.com/locations/kr

> "Bright Data's the most stable IPs network in South Korea"
- ⚠️ 정확한 한국 IP 수량은 공개되지 않음

---

## 3. 티켓팅에 적합한 프록시 종류

### ISP 프록시 vs 주거용 vs 데이터센터

**출처:** https://proxyway.com/best/sneaker-proxies
> "No matter which brand you're targeting, if you want to buy the best sneaker proxies for your bot, look for the following: **Residential or ISP proxies – datacenter proxies used to be a good choice for copping sneakers. Not anymore.**"

**출처:** https://hydraproxy.com/the-best-residential-proxy-for-sneaker-bots-copping-shoes/
> "Datacenter proxies are great for some tasks, but they're not ideal for sneaker botting. While they're often cheaper and faster, they're also way more likely to be detected by sneaker sites."
> "**Residential proxies**, on the other hand, come from real residential ISPs, which means they're much harder for sneaker sites to detect."

**출처:** https://gologin.com/proxies/sneaker-proxy/
> "For checkout speed and fewer bans, use **paid ISP/datacenter or residential sneaker proxies with low latency and nearby locations**"

**출처:** https://iproyal.com/sneaker-proxies/
> "Residential and datacenter proxies each have their own advantages... a **rotating proxy** is usually your best bet."

### 결론 (출처 기반)
- **ISP 프록시**: 데이터센터 속도 + 주거용 신뢰도 (최적)
- **주거용 프록시**: 탐지 회피 최고, 속도는 상대적으로 느림
- **데이터센터**: 속도 빠르지만 차단 위험 높음

---

## 4. 최소 구매 금액 (출처 포함)

| 서비스 | 최소 구매 | 출처 |
|--------|-----------|------|
| IPRoyal | 없음 | https://iproyal.com/pricing/residential-proxies/ |
| Smartproxy | $4 (2GB) | https://decodo.com/proxies/residential-proxies/pricing |
| SOAX | $90 (25GB) | https://soax.com/pricing |
| Bright Data | 없음 (PAYG) | https://brightdata.com/pricing/proxy-network |

---

## 5. Python 연동 방법

### 기본 형식
**출처:** https://stackoverflow.com/questions/55872164/how-to-rotate-proxies-on-a-python-requests

```python
import requests
from itertools import cycle

list_proxy = [
    'socks5://Username:Password@IP1:20000',
    'socks5://Username:Password@IP2:20000',
]

proxy_cycle = cycle(list_proxy)

for i in range(1, 10):
    proxy = next(proxy_cycle)
    proxies = {"http": proxy, "https": proxy}
    r = requests.get(url='https://ident.me/', proxies=proxies)
    print(r.text)
```

**출처:** https://www.webshare.io/academy-article/python-requests-proxy

```python
# 기본 프록시 설정
proxy = {
    "http": "http://username:password@proxy-service.com:12345",
    "https": "http://username:password@proxy-service.com:12345"
}
response = requests.get(url, proxies=proxy)
```

### ⚠️ 서비스별 정확한 호스트명/포트
각 서비스의 공식 문서에서 확인 필요:
- IPRoyal: https://iproyal.com/documentation/
- Decodo: https://decodo.com/docs
- SOAX: https://helpcenter.soax.com
- Bright Data: https://docs.brightdata.com

---

## 6. 실제 티켓팅 관련 정보

### K-POP 티켓팅 사이트
**출처:** https://www.reddit.com/r/seoul/comments/1fl4sep/live_nation_korea_concert_tickets/
> "Interpark Melon Yes24 and Ticketlink handle 99.9999% of all event and concert ticketing in Korea."

### 프록시 사용 주의사항
**출처:** https://www.reddit.com/r/kpophelp/comments/1g0irh4/should_i_get_a_proxy_to_help_me_secure_tickets_in/
> "So far only tickets booked using fake Korean ID got canceled."
> "Getting tickets for Seoul concerts is almost impossible outside of EA due to the high speed internet we have here."

**출처:** https://www.reddit.com/r/kpophelp/comments/10ltaxj/foreign_specifically_us_stans_who_have_flown_to/
> "Be careful with using US credit cards, especially on melon, sometimes the korean sites don't like US credit cards and end up refusing them."

### 티켓팅 사이트 비교
**출처:** https://kpopinion.com/interpark-vs-yes24-vs-melon-ticket-ticketing-sites-for-overseas-concerts/
> "Overall Conclusion: **YES24 is my favoured site to ticket from**. Melon Ticket is decent, but Interpark, if I never have to ticket through you again, I'll live a happy life."

---

## 7. 서비스별 리뷰 요약

### IPRoyal
**출처:** https://blog.proxygraphy.com/best-korean-proxies/
> "IPRoyal stands out for its **genuine, ethically sourced residential proxies and highly competitive pricing structure**."

**출처:** https://www.reddit.com/r/PrivatePackets/comments/1g4sd2e/proxy_wars_2024_best_providers_for_web_scraping/
> "For budget-conscious users: Go with **IPRoyal** for the best combination of price, performance, and customer support."

### Smartproxy (Decodo)
**출처:** https://www.techradar.com/reviews/smartproxy
> "During our test, we found Decodo's residential IPs to have **excellent uptime and speed**."

**출처:** https://proxyway.com/reviews/smartproxy-proxies
> "Decodo (formerly Smartproxy) often appears among the **top choices** in our proxy lists."

### SOAX
**출처:** https://gologin.com/best-proxy-server-services/soax/
> "Pay-as-you-go starts at $6.60 per GB"

**출처:** https://soax.com/ (공식)
> "191 million clean, whitelisted IPs... success rates above 99.5%"

### Bright Data
**출처:** https://research.aimultiple.com/soax/
> "IPRoyal is one of the most affordable proxy service providers among various competitors"
(Bright Data는 프리미엄 가격대로 언급됨)

---

## 8. ⚠️ 확인 필요 사항

1. **서비스별 Python 연동 정확한 호스트명**: 각 공식 문서에서 확인 필요
2. **Smartproxy/Bright Data 한국 IP 정확한 수량**: 공식 발표 없음
3. **할인 코드 유효 기간**: 조사 시점(2026-02-10) 기준, 변경 가능
4. **인터파크 BTS 티켓팅 프록시 차단 여부**: 직접 테스트 필요
5. **ISP 프록시 한국 지원 여부**: 서비스별 확인 필요

---

## 참고 URL 목록

### 공식 사이트
- IPRoyal: https://iproyal.com/pricing/residential-proxies/
- Decodo: https://decodo.com/proxies/residential-proxies/pricing
- SOAX: https://soax.com/pricing
- Bright Data: https://brightdata.com/pricing/proxy-network/residential-proxies

### 한국 IP 관련
- IPRoyal 한국: https://iproyal.com/proxies-by-location/asia/south-korea/
- SOAX 한국: https://soax.com/proxies/locations/korea
- Bright Data 한국: https://brightdata.com/locations/kr

### 리뷰/비교
- Proxyway 스니커 프록시: https://proxyway.com/best/sneaker-proxies
- Proxyway Decodo 리뷰: https://proxyway.com/reviews/smartproxy-proxies
- TechRadar Decodo 리뷰: https://www.techradar.com/reviews/smartproxy
- PCMag SOAX 리뷰: https://www.pcmag.com/reviews/soax

### Reddit 후기
- 티켓팅 프록시: https://www.reddit.com/r/kpophelp/comments/1g0irh4/
- 프록시 비교: https://www.reddit.com/r/PrivatePackets/comments/1g4sd2e/
- Python 코드: https://stackoverflow.com/questions/55872164/
