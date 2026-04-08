import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getMondayOfCurrentWeekUTC(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function readAnswerText(row: Record<string, unknown>): string {
  const candidates = [row.answer_text, row.answer, row.response_text, row.text];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

function readQuestionText(q: Record<string, unknown>): string {
  const candidates = [q.question, q.question_text, q.text, q.prompt, q.title];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return 'Question';
}

function extractAnthropicText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: string }).text;
      if (typeof t === 'string') {
        parts.push(t);
      }
    }
  }
  return parts.join('\n').trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: jsonHeaders,
      });
    }

    const body = await req.json().catch(() => ({})) as { couple_id?: string };
    const couple_id = body.couple_id;
    if (!couple_id || typeof couple_id !== 'string') {
      return new Response(JSON.stringify({ error: 'couple_id required in JSON body' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
        status: 500,
        headers: jsonHeaders,
      });
    }
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: answerRows, error: answersError } = await supabase
      .from('answers')
      .select(
        'question_id, user_id, answer_text, answer, response_text, text, submitted_at, created_at'
      )
      .eq('couple_id', couple_id)
      .gte('submitted_at', sevenDaysAgo)
      .order('submitted_at', { ascending: true });

    if (answersError) {
      console.error('answers fetch:', answersError);
      return new Response(JSON.stringify({ error: 'Failed to fetch answers', details: answersError.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const rows = (answerRows ?? []) as Record<string, unknown>[];
    const questionIds = [...new Set(rows.map((r) => String(r.question_id ?? '')).filter(Boolean))];

    const questionTextById = new Map<string, string>();
    if (questionIds.length > 0) {
      const { data: questionRows, error: qErr } = await supabase
        .from('questions')
        .select('*')
        .in('id', questionIds);
      if (qErr) {
        console.error('questions fetch:', qErr);
        return new Response(JSON.stringify({ error: 'Failed to fetch questions', details: qErr.message }), {
          status: 500,
          headers: jsonHeaders,
        });
      }
      for (const q of questionRows ?? []) {
        const qm = q as Record<string, unknown>;
        const id = qm.id != null ? String(qm.id) : '';
        if (id) {
          questionTextById.set(id, readQuestionText(qm));
        }
      }
    }

    const byQuestion = new Map<string, string[]>();
    for (const r of rows) {
      const qid = String(r.question_id ?? '');
      if (!qid) {
        continue;
      }
      const text = readAnswerText(r);
      if (!text) {
        continue;
      }
      const list = byQuestion.get(qid) ?? [];
      list.push(text);
      byQuestion.set(qid, list);
    }

    const qaLines: string[] = [];
    for (const qid of questionIds) {
      const qText = questionTextById.get(qid) ?? 'Question';
      const answers = byQuestion.get(qid) ?? [];
      qaLines.push(`Question: ${qText}`);
      answers.forEach((a, i) => {
        qaLines.push(`  Partner ${i + 1}: ${a}`);
      });
      qaLines.push('');
    }

    const qaBlock = qaLines.length > 0 ? qaLines.join('\n') : '(No answers recorded in the last 7 days.)';

    const prompt =
      `You are a warm, insightful relationship coach for OurSpark, a couples connection app. Based on the following questions and answers from a couple this week, write a short, warm, personal weekly reflection (3-4 sentences max). Be encouraging, specific to their answers, and end with one gentle question for them to think about together. Never be preachy or clinical. Speak directly to the couple as 'you two'.

This week's questions and answers:
${qaBlock}

Write the reflection now:`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const anthropicJson = await anthropicRes.json().catch(() => null);
    if (!anthropicRes.ok) {
      console.error('Anthropic error:', anthropicRes.status, anthropicJson);
      return new Response(
        JSON.stringify({
          error: 'Anthropic API request failed',
          status: anthropicRes.status,
          details: anthropicJson,
        }),
        { status: 502, headers: jsonHeaders }
      );
    }

    const reflectionText = extractAnthropicText(anthropicJson);
    if (!reflectionText) {
      return new Response(JSON.stringify({ error: 'Empty reflection from model', details: anthropicJson }), {
        status: 502,
        headers: jsonHeaders,
      });
    }

    const monday = getMondayOfCurrentWeekUTC();
    const week_starting = monday.toISOString().slice(0, 10);

    const { error: insertError } = await supabase.from('reflections').insert({
      couple_id,
      reflection_text: reflectionText,
      week_starting,
    });

    if (insertError) {
      console.error('reflections insert:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save reflection', details: insertError.message }),
        { status: 500, headers: jsonHeaders }
      );
    }

    return new Response(JSON.stringify({ reflection: reflectionText }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
