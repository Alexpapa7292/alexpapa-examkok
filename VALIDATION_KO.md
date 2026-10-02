# V12 검증 기록

검증일: 2026-10-02 (한국 시간)

## 검증 범위

- Node.js 구문 검사: 서버·공유 스키마·클라이언트·서비스워커.
- 자동 회귀검사: V11 데이터 보존, 과목·단원·자료 필터, 대화방 키, 파일/옵션 캐시, 엄격 JSON 스키마, SVG 수직선·0 계수·도형·문자 이스케이프·잘못된 범위.
- HTTP: 가입·로그인·로그아웃, 상태 저장, 원본 권한, 분석 재사용·동시 요청 통합, 서버 결과 보관, 튜터 문맥 분리, 다른 과목/없는 문제 거부, 429 대기시간, 삭제.
- 브라우저: 업로드, 조건부 옵션, 과목 허브, 종속 필터, 대화 전환, 응답 대기 중 전환, 새로고침 후 대화 유지, 주요 화면의 가로 넘침.
- 화면 크기: 1440×1000, 태블릿 1024×768, 모바일 390×844. Microsoft Edge의 Chromium 엔진으로 확인했습니다.
- 미리보기는 테스트 계정·검증용 자료이며 실제 사용자 자료가 아닙니다.

## 검증하지 않은 범위

실제 OpenAI 사진 인식·팩트 정확성, 실제 Supabase Auth/DB/Storage 권한, Render 배포는 실제 자격증명 없이 실행하지 않았습니다. API 요청 형식과 처리 흐름은 **모의 응답**으로 검증했습니다. AI에 개념 유도·근거·검산을 요청하는 정책은 구현했으나 모든 실제 답변의 정확성을 보증하지는 않습니다. 배포 안내의 실제 자료 확인 절차를 따르세요.

## 배포 파일 구조

```text
ZIP 루트/
  server.mjs
  package.json
  package-lock.json
  lib/v12.mjs
  public/
    index.html
    legacy.js
    app.js
    model.js
    math.js
    v12.css
    sw.js
    manifest.webmanifest
    icon.svg
  tests/
    v12.test.mjs
    fixture.mjs
    mock-openai.mjs
  Dockerfile
  render.yaml
  supabase.sql
  .env.example
  .gitignore
  .dockerignore
  README.md
  DEPLOY_RENDER_KO.md
  VALIDATION_KO.md
```

ZIP에는 프로젝트 폴더를 중첩하지 않습니다. `node_modules`, 실제 `.env`, 사용자 `data`, `.git`은 제외합니다. 파일 목록과 SHA-256은 ZIP 옆 `V12_GRAPH_FIX_MANIFEST.json`에 기록합니다.

## 그래프 보완판 추가 검증

자동 검증 7개 통과. 빈 새 장면과 유효한 V11 그래프의 충돌, 수학 세부 과목, 원본 기반 그림 보완·재사용·접근 권한, 튜터 그래프 응답·캐시를 검증했습니다. 브라우저에서 그래프가 없는 노트를 보완하고, 대화의 SVG가 새로고침 후 유지되는 것을 확인했습니다. 실제 AI 호출은 모의 응답으로 대체했으며 실서비스의 해당 문제 사진으로 인식 정확도를 확인하지는 못했습니다.
