# Alexpapa 시험콕 V9.5.1

V9.5의 쉬운 교과서/첨부자료 설명 기능을 유지하면서, 화면 버전 표시를 수정하고 AI 분석 경과 시간 표시 및 120초 타임아웃을 추가했습니다.

# Alexpapa 시험콕 V9.5

V9.5는 AI 핵심정리를 내신 시험 대비용으로 심화했습니다. 상세 개념 설명, 시험 포인트, 함정, 비교정리, 서술형 대비, 객관식, 10초 암기카드를 첨부자료 근거 중심으로 생성합니다.

# Alexpapa 시험콕 V8

V7의 로그인·학생별 클라우드 저장·AI 분석을 유지하면서, 자료 원본 보관·AI 분석 이력·과목별 정답률 대시보드·모바일 설치(PWA)를 추가한 통합 버전입니다.

## 핵심 구조
- **Supabase 설정 없음**: 기존처럼 `data/db.json` 로컬 저장
- **Supabase 설정 있음**: Supabase Auth + `student_states` Postgres 테이블 사용
- 로그인 성공 후에는 HttpOnly 서명 쿠키를 사용하므로 브라우저 JS에서 비밀번호/세션 토큰을 직접 보관하지 않습니다.
- OpenAI API 키와 Supabase service role key는 서버 환경변수에만 둡니다.

## 포함 기능
- 로그인 / 회원가입
- 학생별 시험 정보, 자료목록, AI 결과, 오답노트 저장
- 브라우저 로컬 캐시 + 서버 동기화
- 사진/PDF/문서 AI 분석
- 핵심정리 / 예상문제 / 오답 / 시험직전 암기
- Supabase 미설정 시 로컬 개발 모드 자동 fallback
- 업로드 원본 파일 보관: Supabase Storage 또는 로컬 `data/uploads`
- AI 분석 이력 저장
- 전체/과목별 문제 풀이 정답률 대시보드
- 홈 화면 학습 통계
- PWA manifest + service worker로 모바일 홈 화면 설치 준비
- `/api/health`에서 현재 저장 모드(local/supabase) 확인

## 1. 로컬에서 바로 실행
```bash
npm install
npm start
```
브라우저에서 `http://localhost:3000` 접속합니다.

AI 분석까지 사용할 경우 `.env`에 `OPENAI_API_KEY`를 추가합니다.

## 2. Supabase 연결
1. Supabase 프로젝트 생성
2. SQL Editor에서 `supabase.sql` 실행
3. `.env.example`을 `.env`로 복사
4. 아래 3개 값을 입력
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
5. `SESSION_SECRET`을 충분히 긴 임의 문자열로 변경
6. 서버 재시작

정상 연결되면 `/api/health` 응답의 `storage`가 `supabase`로 표시됩니다.

## 보안 주의
- `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `SESSION_SECRET`을 HTML/프론트엔드 코드에 넣지 마세요.
- `.env` 파일은 Git에 올리지 마세요.
- 현재 회원가입은 프로토타입 편의를 위해 Supabase에서 이메일 확인을 자동 처리합니다. 공개 서비스 전에는 이메일 확인/비밀번호 재설정/보호자 계정 정책을 추가하는 것이 좋습니다.

## V8에서 추가된 환경변수
`SUPABASE_BUCKET=examkok-materials` (선택, 기본값 동일)

## 다음 권장 단계
- 보호자 계정 + 학생 계정 연결
- 실제 배포 환경의 HTTPS + 도메인 연결
- 업로드 원본 미리보기/삭제 UI
- 학습 계획 자동 추천과 알림


## Storage 버킷
기본 버킷 이름은 `examkok-materials`입니다. Supabase 연결 시 서버가 버킷 존재 여부를 확인하고 없으면 Private 버킷으로 자동 생성합니다.
