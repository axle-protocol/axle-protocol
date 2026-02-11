# ☁️ BTS 티켓팅 클라우드 배포 가이드

> AWS EC2를 활용한 소규모 확장 배포 가이드

## 📋 목차
1. [인스턴스 생성](#1-aws-ec2-인스턴스-생성)
2. [OS 설정](#2-ubuntu-2204-초기-설정)
3. [Python 설치](#3-python--의존성-설치)
4. [OpenClaw 설치](#4-openclaw-설치-선택)
5. [프로젝트 클론](#5-프로젝트-클론)
6. [환경 변수 설정](#6-환경-변수-설정)
7. [실행](#7-실행-명령어)
8. [모니터링](#8-모니터링)
9. [비용 최적화](#-비용-최적화-팁)

---

## 1. AWS EC2 인스턴스 생성

### 권장 사양

| 항목 | 권장 | 최소 |
|------|------|------|
| 인스턴스 타입 | **t3.medium** | t3.small |
| vCPU | 2 | 1 |
| RAM | 4GB | 2GB |
| 스토리지 | 30GB SSD | 20GB |

### 생성 단계

1. **AWS Console** 접속 → EC2 → "인스턴스 시작"

2. **AMI 선택**
   ```
   Ubuntu Server 22.04 LTS (HVM), SSD Volume Type
   Architecture: 64-bit (x86)
   ```

3. **인스턴스 유형**: `t3.medium` (또는 예산에 따라 t3.small)

4. **키 페어**: 새로 생성하거나 기존 키 사용
   ```bash
   # 로컬에서 키 권한 설정 (다운로드 후)
   chmod 400 your-key.pem
   ```

5. **네트워크 설정**
   - VPC: 기본 VPC
   - 서브넷: 아무거나 (ap-northeast-2a 권장)
   - 퍼블릭 IP 자동 할당: 활성화

6. **보안 그룹** (인바운드 규칙)
   | 유형 | 포트 | 소스 | 용도 |
   |------|------|------|------|
   | SSH | 22 | 내 IP | SSH 접속 |

7. **스토리지**: 30GB gp3 (기본 gp2보다 저렴)

8. **인스턴스 시작** 클릭

### 접속 확인
```bash
ssh -i your-key.pem ubuntu@<퍼블릭-IP>
```

---

## 2. Ubuntu 22.04 초기 설정

### 시스템 업데이트
```bash
sudo apt update && sudo apt upgrade -y
```

### 필수 패키지 설치
```bash
sudo apt install -y \
    build-essential \
    git \
    curl \
    wget \
    unzip \
    htop \
    tmux
```

### 타임존 설정 (한국)
```bash
sudo timedatectl set-timezone Asia/Seoul
```

### 스왑 메모리 설정 (t3.small 사용 시 권장)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 영구 적용
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. Python + 의존성 설치

### Python 3.11 설치
```bash
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip
```

### 버전 확인
```bash
python3.11 --version
# Python 3.11.x
```

### Playwright 의존성 (헤드리스 브라우저용)
```bash
sudo apt install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libnspr4 \
    libnss3
```

---

## 4. OpenClaw 설치 (선택)

OpenClaw를 사용하면 원격 모니터링 및 AI 제어가 가능합니다.

### 설치
```bash
# Node.js 설치 (OpenClaw 의존성)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# OpenClaw 설치
npm install -g openclaw

# 초기화
openclaw init
```

### 노드 페어링 (선택)
```bash
# 기존 게이트웨이에 연결
openclaw pair --gateway <GATEWAY_URL>
```

---

## 5. 프로젝트 클론

### 프로젝트 디렉토리 생성
```bash
mkdir -p ~/projects && cd ~/projects
```

### Git 클론
```bash
# HTTPS
git clone https://github.com/your-repo/bts-ticketing.git

# 또는 직접 파일 업로드
scp -i your-key.pem -r ./bts-ticketing ubuntu@<IP>:~/projects/
```

### 가상환경 생성 및 활성화
```bash
cd ~/projects/bts-ticketing
python3.11 -m venv venv
source venv/bin/activate
```

### 의존성 설치
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### Playwright 브라우저 설치
```bash
playwright install firefox
playwright install-deps firefox
```

### Camoufox 설치
```bash
python -c "import camoufox; camoufox.install()"
```

---

## 6. 환경 변수 설정

### .env.local 생성
```bash
cp .env.example .env.local
nano .env.local
```

### 필수 값 입력
```env
# 인터파크 계정
INTERPARK_ID=your_id
INTERPARK_PWD=your_password

# CapSolver API 키
CAPSOLVER_API_KEY=CAP-xxxxxx

# 프록시 (선택 - 한국 IP)
PROXY_SERVER=geo.iproyal.com:12321
PROXY_USERNAME=customer-xxx-country-kr
PROXY_PASSWORD=xxxxx

# 텔레그램 알림
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHI...
TELEGRAM_CHAT_ID=123456789

# 디버그 모드
DEBUG=false
```

### 권한 보호
```bash
chmod 600 .env.local
```

---

## 7. 실행 명령어

### 기본 실행
```bash
cd ~/projects/bts-ticketing
source venv/bin/activate

# 메인 스크립트 실행
python src/main.py
```

### tmux로 백그라운드 실행 (SSH 끊어도 유지)
```bash
# 새 세션 생성
tmux new -s ticketing

# 스크립트 실행
cd ~/projects/bts-ticketing
source venv/bin/activate
python src/main.py

# 세션 분리: Ctrl+B, D
# 세션 재접속: tmux attach -t ticketing
```

### systemd 서비스로 등록 (자동 시작)
```bash
sudo nano /etc/systemd/system/bts-ticketing.service
```

```ini
[Unit]
Description=BTS Ticketing Macro
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/projects/bts-ticketing
Environment="PATH=/home/ubuntu/projects/bts-ticketing/venv/bin"
ExecStart=/home/ubuntu/projects/bts-ticketing/venv/bin/python src/main.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# 서비스 활성화
sudo systemctl daemon-reload
sudo systemctl enable bts-ticketing
sudo systemctl start bts-ticketing

# 상태 확인
sudo systemctl status bts-ticketing
```

---

## 8. 모니터링

### 로그 확인
```bash
# systemd 서비스 로그
sudo journalctl -u bts-ticketing -f

# 또는 파일 로그 (설정된 경우)
tail -f ~/projects/bts-ticketing/logs/ticketing.log
```

### 시스템 리소스 모니터링
```bash
# CPU, 메모리 실시간
htop

# 디스크 사용량
df -h

# 메모리 상세
free -h
```

### 텔레그램 알림 활용
- 티켓팅 성공/실패 시 자동 알림
- 에러 발생 시 즉시 통보
- `.env.local`의 텔레그램 설정 필수

### CloudWatch 알람 (선택)
```bash
# AWS CLI 설치
sudo apt install -y awscli

# CPU 80% 초과 시 알람
aws cloudwatch put-metric-alarm \
    --alarm-name "BTS-Ticketing-CPU" \
    --metric-name CPUUtilization \
    --namespace AWS/EC2 \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=InstanceId,Value=<instance-id> \
    --evaluation-periods 2 \
    --alarm-actions <sns-topic-arn>
```

---

## 💰 비용 최적화 팁

### 1. 스팟 인스턴스 활용 (최대 90% 절감)

티켓팅은 특정 시간에만 실행되므로 스팟 인스턴스가 적합합니다.

```
온디맨드 t3.medium: ~$0.0416/시간 (서울)
스팟 t3.medium:     ~$0.0125/시간 (약 70% 절감)
```

**주의**: 스팟 인스턴스는 종료될 수 있으므로:
- 중요 티켓팅 시간에는 온디맨드 사용 권장
- 또는 `persistent` 스팟 요청 사용

### 2. 리전 선택

| 리전 | t3.medium 가격 | 레이턴시 (한국→) | 추천 |
|------|----------------|-----------------|------|
| ap-northeast-2 (서울) | $0.0416/h | 최저 | ⭐ 최우선 |
| ap-northeast-1 (도쿄) | $0.0520/h | 낮음 | 대안 |
| ap-northeast-3 (오사카) | $0.0520/h | 낮음 | 대안 |

**결론**: 인터파크 서버가 한국에 있으므로 **서울 리전(ap-northeast-2)** 필수

### 3. 예약 인스턴스 (장기 사용 시)

| 기간 | 결제 방식 | 절감률 |
|------|-----------|--------|
| 1년 | 선결제 없음 | ~31% |
| 1년 | 전액 선결제 | ~40% |
| 3년 | 전액 선결제 | ~60% |

### 4. 인스턴스 스케줄링 (사용 시간만 과금)

```bash
# Lambda + CloudWatch Events로 자동 시작/중지
# 예: 티켓 오픈 30분 전 시작, 1시간 후 중지

# 스케줄 예시 (티켓 오픈 20:00 기준)
# 시작: 매일 19:30 KST
# 중지: 매일 21:00 KST
```

**월 사용량 비교**:
```
24시간 운영: $0.0416 × 24 × 30 = $29.95/월
하루 2시간:  $0.0416 × 2 × 30  = $2.50/월 (92% 절감!)
```

### 5. 스토리지 최적화

- **gp3 사용** (gp2보다 20% 저렴, 성능 동일)
- 불필요한 로그 정기 삭제
- EBS 스냅샷 주기적 정리

### 6. 데이터 전송 비용 주의

- 아웃바운드 트래픽: 100GB 이상 시 비용 발생
- 같은 리전 내 트래픽: 무료
- 프록시 사용 시 데이터 전송량 증가 주의

---

## 📊 예상 월 비용

| 항목 | 24시간 운영 | 스케줄링 (2h/일) |
|------|-------------|-----------------|
| EC2 t3.medium | $29.95 | $2.50 |
| EBS 30GB gp3 | $2.40 | $2.40 |
| 데이터 전송 | ~$1 | ~$0.50 |
| **합계** | **~$33** | **~$5.50** |

스팟 인스턴스 + 스케줄링 조합 시: **~$2-3/월** 가능

---

## 🚀 빠른 시작 (원라이너)

```bash
# 전체 설치 스크립트
curl -sSL https://raw.githubusercontent.com/your-repo/bts-ticketing/main/scripts/cloud-install.sh | bash
```

---

## ⚠️ 주의사항

1. **프록시 필수**: AWS IP는 인터파크에서 차단될 수 있음 → 한국 주거용 프록시 권장
2. **타임존**: 반드시 `Asia/Seoul` 설정 (티켓 오픈 시간 동기화)
3. **헤드리스 모드**: EC2는 GUI 없음 → Camoufox `headless=True` 확인
4. **보안 그룹**: SSH 포트(22)만 열기, 불필요한 포트 차단

---

*마지막 업데이트: 2026-02-10*
