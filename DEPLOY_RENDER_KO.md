# Alexpapa 시험콕 V9 - Render 배포 순서

V9는 **Render + Supabase + OpenAI API** 조합을 기본 배포 경로로 준비했습니다.

## 준비물
1. GitHub 계정
2. Render 계정
3. Supabase 프로젝트
4. OpenAI API 키

## 1) Supabase 준비
- 새 Supabase 프로젝트를 만듭니다.
- SQL Editor에서 이 프로젝트의 `supabase.sql` 전체를 실행합니다.
- Storage 버킷은 기본 이름 `examkok-materials`를 사용합니다. V9.1 서버는 이 버킷이 없으면 최초 업로드 시 Private 버킷으로 자동 생성합니다. 직접 만들 경우에도 반드시 `examkok-materials`로 생성하세요.
- Project Settings > API에서 다음 값을 복사합니다.
  - Project URL -> `SUPABASE_URL`
  - Publishable key -> `SUPABASE_PUBLISHABLE_KEY`
  - Secret key -> `SUPABASE_SECRET_KEY`
- Secret key는 브라우저/HTML에 절대 넣지 않습니다.

## 2) OpenAI API 키 준비
- OpenAI API Platform에서 API key를 생성합니다.
- Render 환경변수 `OPENAI_API_KEY`에만 넣습니다.
- 기본 모델은 `gpt-6-luna`로 설정되어 있습니다. 필요하면 환경변수 `OPENAI_MODEL`만 바꾸면 됩니다.

## 3) GitHub에 V9 폴더 업로드
- 이 폴더 전체를 새 GitHub repository에 올립니다.
- `.env`는 올리지 않습니다.

## 4) Render 배포
- Render Dashboard > New > Blueprint
- 위 GitHub repository를 연결합니다.
- 저장소 루트의 `render.yaml`을 자동으로 읽습니다.
- 생성 과정에서 아래 4개 secret 값을 입력합니다.
  - `OPENAI_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY`
  - `SUPABASE_BUCKET`은 기본값 `examkok-materials` 그대로 사용하면 됩니다.
- `SESSION_SECRET`은 Render가 자동 생성합니다.
- 배포 후 Render가 제공하는 `https://...onrender.com` 주소로 접속합니다.

## 5) 배포 확인
브라우저에서 아래 주소를 엽니다.
- `https://배포주소/api/health`

정상이면 대략 아래처럼 표시됩니다.
```json
{
  "ok": true,
  "ai": true,
  "model": "gpt-6-luna",
  "auth": true,
  "storage": "supabase",
  "version": "0.9.0"
}
```

## 6) 실제 테스트 순서
1. 회원가입
2. 로그아웃 후 다시 로그인
3. 시험 정보 입력
4. 사진 또는 PDF 업로드
5. AI 분석 실행
6. 문제 풀이
7. 로그아웃/재로그인 후 시험정보와 오답이 유지되는지 확인
8. PC와 휴대폰에서 같은 계정으로 로그인해 동기화 확인

## 중요
- V9는 `NODE_ENV=production`에서 Supabase 설정이 없으면 서버가 시작되지 않게 했습니다. 배포 환경에서 로컬 `db.json`에 학생 데이터를 저장해 유실되는 문제를 방지하기 위한 설정입니다.
- 무료 호스팅 플랜은 제공 조건이 바뀔 수 있습니다. 실제 운영 전에는 Render의 현재 플랜 조건을 확인하세요.
