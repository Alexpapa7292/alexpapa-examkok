# V11 배포 방법

1. `alexpapa_examkok_v11_STUDY_OS.zip` 압축을 풉니다.
2. 압축을 풀면 `server.mjs`, `public`, `package.json`, `render.yaml` 등이 **바로 보여야 합니다.** 별도 `v11` 폴더 안에 넣지 마세요.
3. GitHub `Alexpapa7292/alexpapa-examkok` 저장소에서 기존 파일을 V11 파일로 덮어씁니다.
4. Commit 합니다.
5. Render의 `alexpapa-examkok` 서비스에서 자동 배포를 기다리거나 `Manual Deploy → Deploy latest commit`을 누릅니다.
6. Render 상태가 Live가 된 뒤 `https://alexpapa-examkok.onrender.com/?v=11`로 접속합니다.
7. 화면 왼쪽/아래에 `V11 · AI 학습 시스템`이 보이면 정상입니다.

## 기존 환경변수
V10.1에서 쓰던 환경변수를 그대로 사용합니다.
- OPENAI_API_KEY
- OPENAI_MODEL
- SESSION_SECRET
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SECRET_KEY
- SUPABASE_BUCKET
- NODE_ENV

## V11 분석 방식
원본 파일은 최초 분석 1회에만 AI로 읽고, 이후 AI 튜터 질문은 저장된 공부노트를 문맥으로 사용합니다. 큰 자료는 향후 V11.x에서 페이지/단원별 백그라운드 분할 분석을 추가할 예정입니다.
