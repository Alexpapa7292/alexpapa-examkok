# V12 배포 안내

1. 기존 GitHub 저장소의 V11 커밋을 기록하거나 소스를 백업합니다. Supabase 데이터는 삭제하지 않습니다.
2. `alexpapa_examkok_v12_GRAPH_FIX.zip`을 풉니다. ZIP 최상위에 `server.mjs`, `package.json`, `package-lock.json`, `lib/`, `public/`, `render.yaml`이 바로 있습니다.
3. 기존 `Alexpapa7292/alexpapa-examkok` 저장소 **루트**에 파일을 덮어씁니다. `lib/`도 함께 올리세요. ZIP 자체, `node_modules`, 실제 `.env`, `data`는 올리지 않습니다.
4. Render의 **기존** `alexpapa-examkok` 서비스 환경변수를 유지합니다. 특히 SESSION_SECRET, Supabase URL·키·버킷은 기존 값으로 둡니다. 새 Supabase 프로젝트나 새 서비스로 바꾸지 않습니다.
5. 커밋 후 자동 배포를 기다리거나 `Manual Deploy → Deploy latest commit`을 누릅니다. Build Command는 `npm ci`, Start Command는 `npm start`입니다. Dockerfile도 포함되어 있습니다.
6. Live가 되면 `https://alexpapa-examkok.onrender.com/?v=12`로 접속하고 기존 탭을 새로고침합니다. 버전이 **V12**인지 확인합니다. `/api/health`의 `version`은 `12`입니다.
7. 기존 계정으로 과거 자료와 노트를 열어 봅니다. 홈 수학 버튼이 과목 허브로 이동하는지, 공부노트 필터가 동작하는지 확인합니다. 수학·영어 전체 대화와 각 자료/문제 대화가 따로 유지되는지 확인합니다.
8. 실제 문제 사진 1장을 분석하여 원본·근거·개념·원리·그림·풀이가 일치하는지 확인합니다. 같은 파일과 옵션으로 다시 요청하면 저장된 결과를 재사용해야 합니다.

## 기존 환경변수

`OPENAI_API_KEY`, `OPENAI_MODEL`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`(또는 ANON_KEY), `SUPABASE_SECRET_KEY`(또는 SERVICE_ROLE_KEY), `SUPABASE_BUCKET`, `NODE_ENV`를 유지합니다. OPENAI_MODEL의 기존 설정과 접근 권한을 유지하세요. `.env.example`은 예시이며 실제 키가 아닙니다.

기존 `student_states.state` JSON에 필드를 추가하므로 **SQL 마이그레이션이 필요 없습니다**. 기존 Storage 버킷을 유지합니다. `supabase.sql`은 필요한 경우 참고용이며 기존 테이블을 삭제·재생성하지 않습니다.

V11 화면 대화는 원래 저장되지 않아 복원할 수 없습니다. V12 대화부터 계정에 저장됩니다. 과거 분석에 새 근거·풀이 정보가 없으면 기존 결과를 표시하며 해당 정보가 없음을 안내합니다.

## 문제 발생 시

- 로그인/저장: 기존 Supabase 설정·테이블 권한·SESSION_SECRET을 확인합니다.
- AI 오류: 기존 키와 OPENAI_MODEL 접근 권한을 확인합니다.
- 429: 표시한 시간 후 재요청합니다. 저장된 노트는 계속 이용할 수 있습니다.
- 원본 미리보기: 버킷 이름·Storage 권한·원본 파일 존재 여부를 확인합니다.
- V11 화면이 남음: 새로고침하거나 탭을 다시 엽니다. V12 서비스워커는 API 응답을 오프라인 캐시에 보관하지 않습니다.
- 되돌리기: Render에서 V11 커밋으로 롤백합니다. V12 추가 JSON 필드는 데이터에 남습니다. 롤백 전 현재 학습 데이터를 백업하세요.

실제 서비스 배포는 이 작업에서 실행하지 않았습니다. 로컬 검증은 모의 AI 응답·로컬 계정 저장 모드로 진행했습니다. 위 7~8번은 실제 환경의 연결과 분석을 확인하는 절차입니다.

## 그래프 보완판 적용

새 ZIP을 기존과 같은 방식으로 저장소 루트에 덮어쓰고 배포합니다. `public`과 `lib`, `server.mjs`를 모두 갱신하세요. 화면 버전은 V12를 유지하고 패키지 버전은 1.2.1입니다. 예전 노트에 그래프가 없으면 **원본으로 그래프 만들기**를 누르세요. 튜터는 질문을 입력한 뒤 **그래프로 설명**을 누르면 그림을 함께 저장합니다. 기존 대화의 글 답변이 자동으로 그림 답변으로 바뀌지는 않습니다.

새 버전 확인: 사이드바에 **V12 · 그래프 보완**이 보이는지 확인하세요. `/api/health`의 build 값은 `12.1-graph`입니다.
