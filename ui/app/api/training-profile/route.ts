import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  createTrainingSessionToken,
  hashTrainingPassword,
  hashTrainingSessionToken,
  normalizeTrainingUsername,
  parseTrainingSessionCookie,
  TRAINING_SESSION_COOKIE,
  verifyTrainingPassword,
} from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET() {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ profile: null });
  }

  return NextResponse.json({ profile: { id: profile.id, username: profile.username } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = normalizeTrainingUsername(body.username);
  const password = String(body.password ?? '');

  if (username.length < 3 || password.length < 4) {
    return NextResponse.json({ error: 'Username must be 3+ chars and password 4+ chars.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: existing, error: readError } = await supabase
    .from('training_profiles')
    .select('id,username,password_hash')
    .eq('username', username)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  let profile = existing;

  if (profile) {
    if (!verifyTrainingPassword(password, String(profile.password_hash))) {
      return NextResponse.json({ error: 'Wrong training password.' }, { status: 401 });
    }
  } else {
    const { data: created, error: createError } = await supabase
      .from('training_profiles')
      .insert({ username, password_hash: hashTrainingPassword(password) })
      .select('id,username,password_hash')
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    profile = created;
  }

  const token = createTrainingSessionToken();
  const tokenHash = hashTrainingSessionToken(token);
  const { error: sessionError } = await supabase
    .from('training_profiles')
    .update({ session_token_hash: tokenHash, session_created_at: new Date().toISOString() })
    .eq('id', profile.id);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  const response = NextResponse.json({ profile: { id: profile.id, username: profile.username } });
  response.cookies.set(TRAINING_SESSION_COOKIE, `${profile.id}.${token}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(TRAINING_SESSION_COOKIE);
  return NextResponse.json({ profile: null });
}

async function getTrainingProfileFromCookie() {
  const cookieStore = await cookies();
  const parsed = parseTrainingSessionCookie(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('training_profiles')
    .select('id,username,session_token_hash')
    .eq('id', parsed.profileId)
    .maybeSingle();

  if (error || !data?.session_token_hash) {
    return null;
  }

  return hashTrainingSessionToken(parsed.token) === data.session_token_hash ? data : null;
}
