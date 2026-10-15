# 물어물어 구동 시험 도구(2026-10-09)

헤드리스 크로미움(Playwright)과 모의 AI 서버로 출품본을 자동 구동해 본 스크립트다. 리눅스 세션에서 돌린 것이라 경로 두 곳은 환경에 맞게 고친다: `require('/opt/node22/lib/node_modules/playwright')`, `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`(윈도는 `channel: 'msedge'` 또는 `'chrome'`으로 바꾸면 설치된 브라우저를 쓴다).

| 파일 | 하는 일 |
|---|---|
| `mockai.js` | OpenAI 호환 모의 서버(127.0.0.1:11434). 주소 조각을 고정 답으로 돌려주고 요청 본문을 `mockai.log`에 남긴다. `PORT=11434 node mockai.js` |
| `run.js` | 출품본 열기 → 무결성 → 예시 10건 → 공공기관 20건 CSV → 점검표 → 발송명단 1,000건 → 원본+우편번호·사용자 양식 내려받기 → 라벨 → 키오스크 전 과정(문장 1, 넘기기, 문장 8 AI 없이/AI 연결). `node run.js <출품본.html 절대경로> 11434` |
| `tail.js` | 직원 설정(2초 누르기)·AI 연결 시험·외부 주소 차단·자리 비움 지우기(30초 설정)·처리 이력·직접 입력 5줄. `node tail.js <출품본.html>` |
| `eng.js`, `eng2.js` | 브라우저 없이 `src/engine.js`를 node로 직접 돌려 주소 몇 건과 정답표 1,000건을 대조. `node eng2.js <소스 폴더> <정답.csv>` |
| `공공기관20.csv` | 공개 기관 주소 20건(오탈자·옛 시도명·띄어쓰기 없음·지번·지하·시군구 없음 사례) |

발송명단·정답 CSV는 `소스/tools/모의주소_추출.js`로 다시 만든다(`node tools/모의주소_추출.js` → `tools/out/`).

## v1.5·v1.6 추가 시험(2026-10-15)
| 파일 | 하는 일 |
|---|---|
| `form_test.js` | 양식1·양식2·열 끌어 옮기기·시군구 오타 보정. `node form_test.js <출품본.html> <주소록.xlsx> <결과 폴더>` (`양식시험_주소록_만들기.py`로 가상 주소록 생성) |
| `cam_test.js` | 사진으로 읽기 전 과정: 시험 사진을 그린 캔버스 영상을 가짜 웹캠으로 쓰고, 어르신 화면에서 찍기→후보→확인→이름·전화 미리 채움까지(`FULL=1`이면 보내는 분·마침·스티커 인쇄까지). `node cam_test.js <출품본.html> <사진 폴더(cam0.png…·truth.json)> <결과 폴더> [번호]` — 사진은 가상 문자 화면만 쓸 것 |
| `cam_extra_test.js` | 직원 「주소 찾기」 사진 읽기, 카메라 거부(NotAllowedError)·장치 없음 처리 |
| `label_test.js` | 롤 스티커 크기·장수·넘침을 인쇄 모양 PDF로 확인(직원 라벨 창 100×45, 어르신 스티커 80×50, A4 여러 쪽). `pdfinfo`·`pdftoppm` 필요 |
