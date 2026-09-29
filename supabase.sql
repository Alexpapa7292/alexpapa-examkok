-- Alexpapa 시험콕 V9.2 - Supabase SQL Editor에서 1회 실행
create table if not exists public.student_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"exam":{},"materials":[],"wrong":[],"ai":null}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_states enable row level security;

-- 브라우저가 student_states 테이블을 직접 읽고 쓰지 않고,
-- 시험콕 서버가 service role로만 접근하는 구조이므로 public 정책은 만들지 않습니다.
-- service role은 RLS를 우회합니다.

create index if not exists student_states_updated_at_idx on public.student_states(updated_at desc);
