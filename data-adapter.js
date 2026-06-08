/* =============================================================================
 *  data-adapter.js  —  백엔드 교체 지점
 * -----------------------------------------------------------------------------
 *  이 파일만 실제 백엔드로 바꾸면 됩니다. UI(app.js)는 아래 3가지만 사용합니다.
 *
 *    1) RagEval.CONFIG            채점 설정 (top-3, 결과 5개 등)
 *    2) RagEval.loadRegistry()   -> Promise<Row[]>   (api_registry 테이블 fetch)
 *    3) RagEval.searchPgVector(q)-> Promise<{result:[...]}>  (MCP 검색 호출)
 *
 *  실제 연결 시:
 *    - loadRegistry  : SELECT query_id, content, app, tables, author FROM api_registry
 *    - searchPgVector: 배포된 MCP search_pg_vector(userquery) 를 호출하도록 교체
 *      반환 형태: { result: [ { api_id, similarity, content, tables, author }, ... ] }
 * ========================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    passTopK: 3,     // 결과 상위 N개 안에 원래 query_id 가 있으면 정답
    resultSize: 5,   // search_pg_vector 가 돌려주는 결과 개수
    rowCount: 500,   // mock 생성 개수
  };

  /* ---- 결정적 난수 (재실행해도 동일 결과) --------------------------------- */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFor(key) { const s = xmur3(key); return mulberry32(s()); }

  /* ---- mock 도메인 정의 --------------------------------------------------- */
  const DOMAINS = [
    { app: '회원', prefix: 'MEMBER',  tables: ['member','member_auth','member_grade','member_address','member_agreement'],
      entities: [['PROFILE','회원 프로필'],['GRADE','회원 등급'],['ADDRESS','배송지'],['AUTH','회원 인증'],['WITHDRAW','회원 탈퇴'],['AGREEMENT','약관 동의']] },
    { app: '주문', prefix: 'ORDER',   tables: ['orders','order_item','order_claim','delivery','cart'],
      entities: [['ORDER','주문'],['ORDER_ITEM','주문 상품'],['CLAIM','클레임'],['DELIVERY','배송'],['CART','장바구니']] },
    { app: '결제', prefix: 'PAYMENT', tables: ['payment','refund','pay_method','receipt','installment'],
      entities: [['PAYMENT','결제'],['REFUND','환불'],['METHOD','결제수단'],['INSTALLMENT','할부'],['RECEIPT','영수증']] },
    { app: '정산', prefix: 'SETTLE',  tables: ['settlement','fee','payout','ledger','tax_invoice'],
      entities: [['SETTLEMENT','정산'],['FEE','수수료'],['PAYOUT','지급'],['LEDGER','정산 원장'],['INVOICE','세금계산서']] },
    { app: '물류', prefix: 'LOGIS',   tables: ['shipment','inbound','stock','warehouse','tracking'],
      entities: [['SHIPMENT','출고'],['INBOUND','입고'],['STOCK','재고'],['WAREHOUSE','창고'],['TRACKING','배송 추적']] },
    { app: '상품', prefix: 'PRODUCT', tables: ['product','category','product_option','price','brand'],
      entities: [['PRODUCT','상품'],['CATEGORY','카테고리'],['OPTION','상품 옵션'],['PRICE','판매가'],['BRAND','브랜드']] },
    { app: '쿠폰', prefix: 'COUPON',  tables: ['coupon','promotion','discount','coupon_issue'],
      entities: [['COUPON','쿠폰'],['PROMOTION','프로모션'],['DISCOUNT','할인'],['ISSUE','쿠폰 발급']] },
    { app: '리뷰', prefix: 'REVIEW',  tables: ['review','rating','review_report','review_photo'],
      entities: [['REVIEW','리뷰'],['RATING','평점'],['REPORT','리뷰 신고'],['PHOTO','포토 리뷰']] },
    { app: '검색', prefix: 'SEARCH',  tables: ['search_keyword','search_log','ranking','autocomplete'],
      entities: [['KEYWORD','검색어'],['RANKING','검색 랭킹'],['AUTOCOMPLETE','자동완성'],['FILTER','검색 필터']] },
    { app: '알림', prefix: 'NOTI',    tables: ['notification','noti_template','push_log'],
      entities: [['PUSH','푸시 알림'],['EMAIL','이메일'],['SMS','SMS'],['TEMPLATE','알림 템플릿']] },
    { app: '포인트', prefix: 'POINT', tables: ['point','point_history','point_policy'],
      entities: [['POINT','포인트'],['EARN','적립'],['USE','사용'],['EXPIRE','소멸']] },
    { app: '광고', prefix: 'AD',      tables: ['ad_campaign','ad_banner','ad_report'],
      entities: [['CAMPAIGN','광고 캠페인'],['BANNER','배너'],['BUDGET','광고 예산'],['REPORT','광고 리포트']] },
  ];

  const ACTIONS = [
    ['GET','단건 조회','조회'], ['LIST','목록 조회','목록 조회'], ['CREATE','등록','등록'],
    ['UPDATE','수정','수정'],   ['DELETE','삭제','삭제'],       ['SEARCH','검색','검색'],
    ['SUMMARY','집계','집계'],   ['EXPORT','내보내기','추출'],   ['BATCH','일괄 처리','일괄 처리'],
    ['SYNC','동기화','동기화'],
  ];

  const AUTHORS = ['김민준','이서연','박지후','최예린','정우진','한도윤','오하늘','윤지아','임채원','강태현','서주안','노다은'];

  const Q_TEMPLATES = [
    (E,A,P) => `${E} ${A} 기능이 필요한데 어떤 API를 호출하면 되나요?`,
    (E,A,P) => `${P} 쪽에서 ${E} 데이터를 ${A}하려면 어떤 걸 써야 해?`,
    (E,A,P) => `${E} ${A} 관련 API 알려줘`,
    (E,A,P) => `${E}을(를) ${A}하는 엔드포인트를 찾고 있어요`,
    (E,A,P) => `${A} 할 때 ${E} 처리하는 API 어떤 거예요?`,
    (E,A,P) => `${P} 도메인에서 ${E} ${A} 어떻게 하나요?`,
  ];

  /* ---- 500행 생성 (action-major 로 도메인 균등 분포) ---------------------- */
  const ROWS = [];
  const ROW_BY_ID = Object.create(null);
  const APP_INDEX = Object.create(null);       // app -> query_id[]
  const QUESTION_INDEX = Object.create(null);  // normalized question -> {query_id, qIndex}
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  (function build() {
    outer:
    for (let a = 0; a < ACTIONS.length; a++) {
      const [aKey, aKo, verb] = ACTIONS[a];
      for (let d = 0; d < DOMAINS.length; d++) {
        const dom = DOMAINS[d];
        for (let e = 0; e < dom.entities.length; e++) {
          if (ROWS.length >= CONFIG.rowCount) break outer;
          const [eKey, eKo] = dom.entities[e];
          const query_id = `${dom.prefix}_${eKey}_${aKey}`;
          const rng = rngFor(query_id);

          const description = `[${dom.app}] ${eKo} ${aKo}`;
          const summary = `${eKo} 데이터를 ${verb} 처리하는 ${dom.app} 도메인 API`;
          const base = Math.floor(rng() * Q_TEMPLATES.length);
          const questions = [0, 2, 4].map((off) =>
            Q_TEMPLATES[(base + off) % Q_TEMPLATES.length](eKo, aKo, dom.app)
          );
          const content = [description, summary, ...questions].join('\n');

          const author = AUTHORS[Math.floor(rng() * AUTHORS.length)];
          const tn = 2 + Math.floor(rng() * 2);
          const tbl = [...dom.tables].sort(() => rng() - 0.5).slice(0, tn).join(',');

          const row = { query_id, app: dom.app, author, tables: tbl,
            description, summary, questions, content };
          ROWS.push(row);
          ROW_BY_ID[query_id] = row;
          (APP_INDEX[dom.app] || (APP_INDEX[dom.app] = [])).push(query_id);
          questions.forEach((q, qi) => { QUESTION_INDEX[norm(q)] = { query_id, qIndex: qi }; });
        }
      }
    }
  })();

  /* ---- mock 검색: 결정적 결과 (재실행 동일) ------------------------------ */
  function buildResult(query_id, qIndex) {
    const row = ROW_BY_ID[query_id];
    const rng = rngFor(query_id + '#' + qIndex + '#search');

    // 정답이 놓일 순위 결정 (현실적인 분포: top-3 성공 ~83%)
    const r = rng();
    let correctRank; // 1-based, 99 = top-5 밖(완전 누락)
    if (r < 0.55) correctRank = 1;
    else if (r < 0.72) correctRank = 2;
    else if (r < 0.83) correctRank = 3;
    else if (r < 0.92) correctRank = 4;
    else if (r < 0.965) correctRank = 5;
    else correctRank = 99;

    // 같은 app 의 다른 API들을 그럴듯한 오답(distractor) 후보로
    const sameApp = (APP_INDEX[row.app] || []).filter((id) => id !== query_id);
    const shuffled = [...sameApp].sort(() => rng() - 0.5);
    const pool = shuffled.length >= CONFIG.resultSize
      ? shuffled
      : shuffled.concat(ROWS.map((x) => x.query_id).filter((id) => id !== query_id).sort(() => rng() - 0.5));

    const ids = [];
    let di = 0;
    for (let rank = 1; rank <= CONFIG.resultSize; rank++) {
      if (rank === correctRank) ids.push(query_id);
      else ids.push(pool[di++]);
    }

    // 유사도: 내림차순 (높을수록 유사)
    let sim = 5.0 + rng() * 2.2;
    return ids.map((id, i) => {
      if (i > 0) sim -= 0.25 + rng() * 0.7;
      const rr = ROW_BY_ID[id];
      return {
        api_id: id,
        similarity: Number(Math.max(0.12, sim).toFixed(5)),
        content: rr.description + '\n' + rr.summary, // 앞 2줄만
        tables: rr.tables,
        author: rr.author,
      };
    });
  }

  // 인덱스에 없는 임의 질의용 폴백(토큰 겹침 랭킹)
  function fallbackSearch(q) {
    const qt = new Set(norm(q).split(' '));
    const scored = ROWS.map((row) => {
      const tt = new Set(norm(row.content).split(' '));
      let inter = 0; qt.forEach((t) => { if (tt.has(t)) inter++; });
      return { row, s: inter / (qt.size + 0.001) + rngFor(row.query_id + q)() * 0.05 };
    }).sort((a, b) => b.s - a.s).slice(0, CONFIG.resultSize);
    let sim = 4.4;
    return scored.map(({ row }, i) => {
      sim -= i ? 0.3 + i * 0.1 : 0;
      return { api_id: row.query_id, similarity: Number(Math.max(0.1, sim).toFixed(5)),
        content: row.description + '\n' + row.summary, tables: row.tables, author: row.author };
    });
  }

  /* ---- 공개 API ----------------------------------------------------------- */
  function loadRegistry() {
    // 실제로는 DB 조회. mock 은 즉시 반환.
    return Promise.resolve(ROWS.map((r) => ({
      query_id: r.query_id, app: r.app, author: r.author, tables: r.tables,
      description: r.description, summary: r.summary, questions: r.questions.slice(), content: r.content,
    })));
  }

  function searchPgVector(userquery) {
    const hit = QUESTION_INDEX[norm(userquery)];
    const result = hit ? buildResult(hit.query_id, hit.qIndex) : fallbackSearch(userquery);
    return Promise.resolve({ result });
  }

  window.RagEval = { CONFIG, loadRegistry, searchPgVector };
})();
