# RAG Search Evaluation

`api_registry` 검색 품질을 빠르게 확인하기 위한 정적 RAG 검색 평가 UI입니다.

현재 버전은 mock 데이터와 mock `search_pg_vector` 결과를 사용합니다. 실제 백엔드에 연결할 때는 `data-adapter.js`만 교체하면 됩니다.

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

`data-adapter.js`의 아래 공개 API를 실제 구현으로 바꾸면 됩니다.

```js
RagEval.loadRegistry()
RagEval.searchPgVector(userquery)
```

예상 데이터 형태:

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

채점은 각 API별 질문 3개에 대해 정답 `query_id`가 `top-3` 안에 들어왔는지 기준으로 계산합니다.
