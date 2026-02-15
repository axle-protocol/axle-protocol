#!/usr/bin/env node
/**
 * generate_mock_data.mjs
 *
 * Generates realistic Korean SmartStore mock data:
 *   - 20 vendors with PBKDF2-SHA256 hashed passwords
 *   - 100 products across 4 categories
 *   - vendor-product mapping (each product -> exactly 1 vendor)
 *   - 30 orders with mixed statuses
 *
 * Outputs JSON files into ../data/
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pbkdf2Hash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const dk = crypto.pbkdf2Sync(password, salt, 120_000, 32, 'sha256');
  return dk.toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdf2Hash(password, salt);
  return { salt, hash, algo: 'pbkdf2_sha256', iter: 120_000 };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function padZero(n, len) {
  return String(n).padStart(len, '0');
}

function randomPhone() {
  return `010-${padZero(randInt(1000, 9999), 4)}-${padZero(randInt(1000, 9999), 4)}`;
}

function randomDate(startYear, endYear) {
  const start = new Date(startYear, 0, 1).getTime();
  const end = new Date(endYear, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start)).toISOString();
}

function writeJson(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  -> ${filepath}  (${Array.isArray(data) ? data.length + ' items' : 'object'})`);
}

// ---------------------------------------------------------------------------
// 1. Vendors
// ---------------------------------------------------------------------------

const VENDOR_NAMES = [
  '대한식품', '미래유통', '세영상사', '한빛무역', '동아물산',
  '청운유통', '삼성상회', '우리식품', '태양무역', '하나유통',
  '금성상사', '백두물산', '강산식품', '동방유통', '새한상사',
  '보성무역', '한솔물산', '성진유통', '제일상사', '다온식품',
];

function generateVendors() {
  const vendors = [];
  for (let i = 0; i < 20; i++) {
    const username = `vendor${padZero(i + 1, 2)}`;
    const { salt, hash, algo, iter } = hashPassword('test1234');
    vendors.push({
      id: crypto.randomUUID(),
      username,
      displayName: VENDOR_NAMES[i],
      password: { salt, hash, algo, iter },
      active: true,
      createdAt: randomDate(2024, 2025),
    });
  }
  vendors.sort((a, b) => a.username.localeCompare(b.username));
  return vendors;
}

// ---------------------------------------------------------------------------
// 2. Products
// ---------------------------------------------------------------------------

const PRODUCT_POOL = {
  food: [
    '[무료배송] 국내산 프리미엄 갈비탕 600g x 5팩',
    '제주 흑돼지 볶음밥 250g x 10인분',
    '전통 방식 된장찌개 밀키트 3인분',
    '유기농 현미 떡국떡 1kg',
    '남해 멸치 다시팩 100입 대용량',
    '강원도 감자 수제비 밀키트 4인분',
    '국산 콩 두부 찌개용 300g x 6팩',
    '100% 한우 육포 프리미엄 선물세트',
    '제철 과일 모듬 선물세트 3kg',
    '전남 고흥 유자차 1kg 2병 세트',
    '국내산 참기름 들기름 선물세트',
    '충북 충주 사과 5kg 가정용',
    '해남 고구마말랭이 100g x 10봉',
    '속초 수제 오징어순대 500g',
    '전주 비빔밥 밀키트 2인분 x 3세트',
    '안동 간고등어 세트 10손',
    '국산 벌꿀 2.4kg 대용량',
    '이천 햅쌀 10kg 특등급',
    '보성 녹차 티백 100입 x 2박스',
    '홍삼정 에브리타임 30포 선물세트',
    '경주 찰보리빵 30개입',
    '순창 전통 고추장 1kg',
    '완도 전복죽 300g x 6팩',
    '양양 송이버섯 자연산 500g',
    '제주 감귤 칩 50g x 12봉',
  ],
  household: [
    '프리미엄 대나무 섬유 타올 세트 6매',
    '친환경 다용도 세탁세제 3L 대용량',
    '스테인리스 304 텀블러 500ml',
    '항균 도마 세트 (대+중+소)',
    '무선 LED 센서등 3개 세트',
    '원목 다용도 수납 선반 3단',
    '실리콘 주방 조리도구 9종 세트',
    '프리미엄 극세사 이불 세트 퀸',
    '탈취 제습제 옷장용 12개입',
    '접이식 빨래건조대 스탠드형',
    '무소음 탁상 시계 인테리어용',
    '스텐 음식물 쓰레기통 3L',
    '소파 커버 3인용 워셔블',
    '미세먼지 방충망 필터 5매',
    '주방 벽걸이 양념통 세트 8구',
    '고밀도 매트리스 토퍼 퀸 7cm',
    'LED 스탠드 조명 책상용',
    '세라믹 코팅 프라이팬 28cm',
    '무선 핸디 청소기 경량형',
    '접이식 쇼핑 카트 대용량',
    '자동 센서 휴지통 12L',
    '규조토 발매트 프리미엄',
    '이중진공 보온병 1L',
    '인덕션 겸용 냄비 세트 4종',
    '창문 단열 에어캡 5m',
  ],
  beauty: [
    '히알루론산 수분 크림 50ml',
    '비타민C 세럼 30ml 브라이트닝',
    '프리미엄 선크림 SPF50+ PA++++',
    '올인원 BB크림 자연스러운 피부표현',
    '녹차 클렌징 폼 150ml',
    '콜라겐 시트 마스크팩 30매입',
    '아르간 오일 헤어 에센스 100ml',
    '제주 동백 오일 페이스 오일 30ml',
    '세라마이드 보습 토너 200ml',
    '레티놀 안티에이징 크림 30g',
    '프로폴리스 앰플 50ml',
    '어성초 진정 크림 80ml',
    '달팽이 크림 리페어 60ml',
    '립 틴트 벨벳 매트 5색 세트',
    'EGF 펩타이드 아이크림 30ml',
    '소나무 수액 미스트 150ml',
    '약산성 폼 클렌저 200ml',
    '자초 립밤 유기농 4g x 3개',
    '티트리 스팟 패치 72매',
    '진주 톤업 크림 50g',
    '장미수 미스트 토너 200ml',
    '편백수 진정 앰플 50ml',
    '수분 폭탄 슬리핑 팩 100ml',
    '블랙 숯 필오프 마스크 100ml',
    '무기자차 선스틱 SPF50+',
  ],
  fashion: [
    '오버핏 무지 반팔 티셔츠 5색',
    '남녀공용 조거팬츠 기모 M-3XL',
    '캐시미어 니트 머플러 겨울용',
    '양털 후리스 집업 자켓',
    '소가죽 미니 크로스백 블랙',
    '데일리 볼캡 모자 6컬러',
    '극세사 수면양말 5켤레 세트',
    '프리미엄 울 코트 남성 오버핏',
    '스트레치 슬림핏 청바지 연청',
    '방수 등산화 경량 트레킹화',
    '겨울 패딩 점퍼 경량 다운',
    '린넨 원피스 여름용 프리사이즈',
    '사파리 자켓 봄가을 아우터',
    '기능성 쿨링 런닝 셔츠',
    '가죽 벨트 자동 버클 남성용',
    '울 비니 방한 모자 8색',
    '기모 레깅스 기모안감 여성용',
    '와이드 슬랙스 남녀공용 S-2XL',
    '면 라운드 긴팔 티셔츠 3팩',
    '실크 스카프 정사각형 90cm',
    '스포츠 백팩 노트북 수납',
    '스웨이드 로퍼 남성 캐주얼',
    '니트 가디건 오버핏 봄가을',
    '방한 장갑 터치스크린 가능',
    '플리츠 미디 스커트 주름',
  ],
};

function generateProducts() {
  const products = [];
  const categories = Object.keys(PRODUCT_POOL);
  let idx = 0;

  // 25 products per category = 100 total
  for (const category of categories) {
    const names = PRODUCT_POOL[category];
    for (let i = 0; i < 25; i++) {
      idx++;
      products.push({
        productNo: `980${padZero(idx, 4)}`,
        productName: names[i],
        category,
        price: randInt(5, 120) * 1000,
        createdAt: randomDate(2024, 2025),
      });
    }
  }

  return products;
}

// ---------------------------------------------------------------------------
// 3. Mapping  (productNo -> vendorUsername, 1:1)
// ---------------------------------------------------------------------------

function generateMapping(products, vendors) {
  const vendorUsernames = vendors.map((v) => v.username);

  // Create a distribution: random counts that sum to 100
  const counts = new Array(20).fill(3); // start each with 3 => 60
  let remaining = 100 - 60; // 40 left to distribute
  while (remaining > 0) {
    const vi = randInt(0, 19);
    if (counts[vi] < 10) {
      counts[vi]++;
      remaining--;
    }
  }

  const slots = [];
  for (let vi = 0; vi < 20; vi++) {
    for (let c = 0; c < counts[vi]; c++) {
      slots.push(vendorUsernames[vi]);
    }
  }

  // Shuffle slots
  for (let i = slots.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const mapping = {};
  products.forEach((p, i) => {
    mapping[p.productNo] = slots[i];
  });

  return mapping;
}

// ---------------------------------------------------------------------------
// 4. Orders
// ---------------------------------------------------------------------------

const KOREAN_LAST_NAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍',
];
const KOREAN_FIRST_NAMES = [
  '민수', '지현', '서연', '지훈', '수빈', '하준', '은지', '준서',
  '예진', '도현', '유나', '민재', '서윤', '현우', '지아', '성민',
  '소연', '재현', '윤아', '태영',
];

const ADDRESSES = [
  '서울특별시 강남구 테헤란로 152 강남파이낸스센터 12층',
  '서울특별시 서초구 서초대로 398 플래티넘타워 5층',
  '서울특별시 마포구 양화로 45 메세나폴리스 B동 1205호',
  '경기도 성남시 분당구 판교역로 235 에이치스퀘어 N동 8층',
  '경기도 수원시 영통구 광교중앙로 170 광교비즈니스센터 3층',
  '인천광역시 연수구 송도과학로 32 송도테크노파크 IT센터',
  '부산광역시 해운대구 센텀중앙로 97 센텀스카이비즈 18층',
  '대구광역시 동구 동대구로 489 대구혁신도시 A-2블록',
  '대전광역시 유성구 대학로 99 카이스트 본원 연구동',
  '광주광역시 서구 상무중앙로 110 광주무역회관 6층',
  '경기도 고양시 일산동구 호수로 358-4 킨텍스 제1전시장',
  '서울특별시 송파구 올림픽로 300 롯데월드타워 35층',
  '서울특별시 영등포구 여의대로 108 파크원타워1 22층',
  '경기도 화성시 동탄순환대로 830 동탄센트럴파크 상가 203호',
  '서울특별시 용산구 이태원로 294 크라운프라자호텔 B1',
  '경기도 용인시 수지구 성복중앙로 15 성복역 롯데캐슬 상가',
  '충청북도 청주시 흥덕구 가경동 1380 가경아이파크 105동 302호',
  '전라북도 전주시 덕진구 기린대로 502 전주혁신도시 우체국',
  '경상남도 창원시 의창구 원이대로 362 창원컨벤션센터',
  '제주특별자치도 제주시 연동 312-24 제주스타트업캠퍼스 2층',
  '서울특별시 종로구 세종대로 209 광화문프라자 7층',
  '서울특별시 중구 을지로 170 을지한국빌딩 3층',
  '경기도 파주시 문발로 211 파주출판도시 세종홀',
  '서울특별시 강서구 마곡중앙로 161-8 이너매스마곡 12층',
  '서울특별시 성동구 왕십리로 83-21 아크로서울포레스트 D동 501호',
  '경기도 하남시 미사강변중앙로 190 미사강변도시 센트럴파크',
  '울산광역시 남구 삼산로 262 롯데호텔울산 B1',
  '강원특별자치도 원주시 시청로 1 원주시청 신관 4층',
  '충청남도 천안시 서북구 불당25로 65 불당스마트타운 A동',
  '세종특별자치시 한누리대로 2130 세종정부청사 15동',
];

const CARRIER_CODES = ['CJGLS', 'HANJIN', 'LOTTE', 'EPOST', 'LOGEN'];
const CARRIER_NAMES = {
  CJGLS: 'CJ대한통운',
  HANJIN: '한진택배',
  LOTTE: '롯데택배',
  EPOST: '우체국택배',
  LOGEN: '로젠택배',
};

function generateOrders(products, mapping, vendors) {
  const orders = [];
  const vendorMap = {};
  vendors.forEach((v) => {
    vendorMap[v.username] = v;
  });

  // Statuses: 10 shipped, 10 assigned, 10 pending
  const statusDist = [
    ...new Array(10).fill('shipped'),
    ...new Array(10).fill('assigned'),
    ...new Array(10).fill('pending'),
  ];
  // Shuffle
  for (let i = statusDist.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [statusDist[i], statusDist[j]] = [statusDist[j], statusDist[i]];
  }

  for (let i = 0; i < 30; i++) {
    const product = pick(products);
    const vendorUsername = mapping[product.productNo];
    const vendor = vendorMap[vendorUsername];
    const status = statusDist[i];

    const lastName = pick(KOREAN_LAST_NAMES);
    const firstName = pick(KOREAN_FIRST_NAMES);
    const recipientName = lastName + firstName;

    const orderNo = `2026${padZero(randInt(1, 2), 2)}${padZero(randInt(1, 28), 2)}-${padZero(randInt(100000, 999999), 6)}`;
    const productOrderNo = `${orderNo}-${padZero(randInt(1, 5), 2)}`;
    const createdAt = randomDate(2026, 2026);

    const order = {
      id: crypto.randomUUID(),
      orderNo,
      productOrderNo,
      productNo: product.productNo,
      productName: product.productName,
      quantity: randInt(1, 5),
      recipientName,
      recipientPhone: randomPhone(),
      recipientAddress: pick(ADDRESSES),
      vendorUsername,
      vendorDisplayName: vendor.displayName,
      status,
      createdAt,
      updatedAt: createdAt,
    };

    if (status === 'shipped') {
      const carrierCode = pick(CARRIER_CODES);
      order.tracking = {
        carrierCode,
        carrierName: CARRIER_NAMES[carrierCode],
        trackingNo: String(randInt(100000000000, 999999999999)),
        shippedAt: new Date(
          new Date(createdAt).getTime() + randInt(1, 3) * 86400000
        ).toISOString(),
      };
    }

    orders.push(order);
  }

  // Sort by createdAt descending (newest first)
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return orders;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating mock data for SmartStore dashboard...\n');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const vendors = generateVendors();
console.log(`[1/4] Generated ${vendors.length} vendors`);
writeJson('vendors.json', vendors);

const products = generateProducts();
console.log(`\n[2/4] Generated ${products.length} products`);
writeJson('products.json', products);

const mapping = generateMapping(products, vendors);
const mappingCount = Object.keys(mapping).length;
console.log(`\n[3/4] Generated mapping (${mappingCount} product-vendor pairs)`);
writeJson('mapping.json', mapping);

const orders = generateOrders(products, mapping, vendors);
console.log(`\n[4/4] Generated ${orders.length} orders`);
writeJson('orders.json', orders);

// Print summary
console.log('\n--- Summary ---');
console.log(`Vendors:  ${vendors.length}`);
console.log(`Products: ${products.length}`);
console.log(`Mapping:  ${mappingCount} entries`);
console.log(`Orders:   ${orders.length}  (shipped: ${orders.filter((o) => o.status === 'shipped').length}, assigned: ${orders.filter((o) => o.status === 'assigned').length}, pending: ${orders.filter((o) => o.status === 'pending').length})`);

// Vendor product distribution
const distrib = {};
for (const [, vUser] of Object.entries(mapping)) {
  distrib[vUser] = (distrib[vUser] || 0) + 1;
}
const distribVals = Object.values(distrib);
console.log(`Product distribution per vendor: min=${Math.min(...distribVals)}, max=${Math.max(...distribVals)}, avg=${(distribVals.reduce((a, b) => a + b, 0) / distribVals.length).toFixed(1)}`);
console.log('\nDone.');
