# RAG Search Evaluation

`api_registry` 테이블 기반 RAG 검색 품질을 빠르게 확인하기 위한 정적 평가 UI입니다.

현재 버전은 mock 데이터를 제거하고 실제 API를 호출하도록 구성했습니다. 마지막 연결 값은 `data-adapter.js` 상단에서 수정하면 됩니다.

## 구성

- `index.html`: 화면 레이아웃과 스타일
- `app.js`: 필터, 선택, 측정, 점수 표시 등 UI 로직
- `data-adapter.js`: 데이터/검색 어댑터

## 실행

별도 빌드 없이 브라우저에서 `index.html`을 열면 됩니다.

로컬 서버로 확인하려면:

```bash
python3 -m http.server 8000
```

그리고 브라우저에서 `http://localhost:8000`에 접속합니다.

## 실제 검색 백엔드 연결

`data-adapter.js` 상단의 값을 실제 서버에 맞게 수정합니다.

```js
const API_ENDPOINTS = {
  registry: '/api/api-registry',
  search: '/api/search-pg-vector',
};

const API_HEADERS = {
  'Content-Type': 'application/json',
  // Authorization: 'Bearer ...',
};
```

`registry` 응답은 배열, `{ rows: [...] }`, `{ data: [...] }`, `{ result: [...] }` 형태를 지원합니다.

기준 테이블은 `api_registry`입니다.

- `query_id`: API 이름이자 중복되지 않는 키 값
- `content`: 총 5라인 텍스트
- `content_vector`: `bge-m3` 1024차원 임베딩 값
- `openapi`: Swagger JSONB 값
- `app`: 앱/도메인 이름
- `tables`: 관련 테이블
- `author`: 작성자

`content`는 아래처럼 파싱합니다.

```text
1번째 줄: description
2번째 줄: summary
3번째 줄: x-question 1
4번째 줄: x-question 2
5번째 줄: x-question 3
```

예상 registry row:

```js
{
  query_id: 'MEMBER_PROFILE_GET',
  content: '[회원] 회원 프로필 단건 조회\n회원 프로필 데이터를 조회하는 API\n회원 프로필 조회 기능이 필요한데 어떤 API를 호출하면 되나요?\n회원 데이터를 조회하려면 어떤 걸 써야 해?\n회원 프로필 관련 API 알려줘',
  openapi: { /* swagger json */ },
  app: '회원',
  tables: 'member,member_auth',
  author: '김민준'
}
```

`search`는 `POST`로 호출합니다.

요청 body:

```js
{
  userquery: '회원 프로필 관련 API 알려줘',
  limit: 5
}
```

예상 search 응답:

```js
{
  result: [
    {
      api_id: 'MEMBER_PROFILE_GET',
      similarity: 4.9821,
      content: '...',
      tables: 'member,member_auth',
      author: '김민준'
    }
  ]
}
```

채점은 각 `query_id`의 x-question 3개를 각각 `search_pg_vector(userquery)`로 검색하고, 정답 `query_id`가 `top-3` 안에 들어왔는지 기준으로 `3/3`, `2/3`처럼 계산합니다.

필드명이 다르면 `data-adapter.js`의 `FIELD_MAP`만 수정하면 됩니다.
