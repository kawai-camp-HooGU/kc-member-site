"use client";
// ============================================================
// 公開回答画面（/f/[slug]）
//   セクション＝ページでページ送り。ログイン会員は自動で本人紐付け＋初期表示。
//   未ログイン（外部）は氏名・メールを入力して回答（後から会員に紐付け可）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { isVisible, validateField, formIsOpen } from "../../lib/formParse";
import type { AnswerMap } from "../../lib/formParse";
import { PREFECTURES } from "../../lib/members";
import type { FormDef, FormField } from "../../lib/models";
import { IS_DISPLAY_ONLY } from "../../lib/models";

interface Props { form: FormDef }

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[15px] focus:outline-none focus:border-gray-800 bg-white";

export function PublicForm({ form }: Props) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [files, setFiles] = useState<Record<number, { name: string; dataUrl: string }>>({});
  const [errs, setErrs] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);
  const [me, setMe] = useState<{ id: number; name: string; email: string } | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [guestErr, setGuestErr] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [fatal, setFatal] = useState("");

  const color = form.design.color || "#dc2626";
  const open = formIsOpen(form);

  // 表示するセクション（条件を満たすもの）
  const sections = useMemo(
    () => form.sections.filter((s) => isVisible(s.condition, answers)),
    [form.sections, answers],
  );
  const sec = sections[Math.min(page, Math.max(sections.length - 1, 0))];
  const isLast = page >= sections.length - 1;

  // 既定値
  useEffect(() => {
    const init: AnswerMap = {};
    for (const s of form.sections) {
      for (const f of s.fields) {
        if (f.defaultValue) init[f.id] = f.type === "checkbox" ? [f.defaultValue] : f.defaultValue;
      }
    }
    setAnswers((a) => ({ ...init, ...a }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ログイン会員の自動入力
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: m } = await supabase
        .from("members").select("id, name, email").eq("user_id", session.user.id).eq("is_deleted", false).maybeSingle();
      if (!m) return;
      setMe({ id: m.id, name: m.name, email: m.email ?? "" });
      if (!form.autofillMember) return;
      setAnswers((prev) => {
        const next = { ...prev };
        for (const s of form.sections) {
          for (const f of s.fields) {
            if (next[f.id]) continue;
            if (f.saveTo === "name") next[f.id] = m.name;
            if (f.saveTo === "email") next[f.id] = m.email ?? "";
          }
        }
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (f: FormField, v: string | string[]) => {
    setAnswers((a) => ({ ...a, [f.id]: v }));
    setErrs((e) => (e[f.id] ? { ...e, [f.id]: "" } : e));
  };

  const toggleCheck = (f: FormField, label: string) => {
    const cur = Array.isArray(answers[f.id]) ? (answers[f.id] as string[]) : [];
    const next = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label];
    set(f, next);
  };

  const pickFile = (f: FormField, file: File | null) => {
    if (!file) { setFiles((p) => { const n = { ...p }; delete n[f.id]; return n; }); set(f, ""); return; }
    if (file.size > 5 * 1024 * 1024) { setErrs((e) => ({ ...e, [f.id]: "5MB以下のファイルを選択してください" })); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setFiles((p) => ({ ...p, [f.id]: { name: file.name, dataUrl: String(reader.result) } }));
      set(f, file.name);
    };
    reader.readAsDataURL(file);
  };

  // ページ内の検証
  const validatePage = useCallback((): boolean => {
    if (!sec) return true;
    const e: Record<number, string> = {};
    for (const f of sec.fields) {
      if (IS_DISPLAY_ONLY(f.type)) continue;
      if (!isVisible(f.condition, answers)) continue;
      const msg = validateField(f, answers[f.id]);
      if (msg) e[f.id] = msg;
    }
    setErrs((prev) => ({ ...prev, ...e }));
    return Object.keys(e).length === 0;
  }, [sec, answers]);

  const next = () => { if (validatePage()) { setPage((p) => p + 1); window.scrollTo(0, 0); } };
  const prev = () => { setPage((p) => Math.max(0, p - 1)); window.scrollTo(0, 0); };

  const submit = async () => {
    if (!validatePage()) return;
    if (!me) {
      if (!guest.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) {
        setGuestErr("お名前・ニックネームとメールアドレスをご入力ください");
        return;
      }
      setGuestErr("");
    }
    if (form.confirmDialog && !confirm(form.confirmText || "この内容で送信します。よろしいですか？")) return;

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/form/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          slug: form.slug,
          answers,
          files,
          guestName: guest.name,
          guestEmail: guest.email,
          // Phase 3：用語衝突の解消
          //   channel … どの導線でフォームに来たか（direct|chat|broadcast|scenario|qr）
          //   srcKey  … 流入経路（?src=）。sources.key と照合して members.source_id へ引き継ぐ
          channel: new URLSearchParams(window.location.search).get("ch") || "direct",
          srcKey:  new URLSearchParams(window.location.search).get("src"),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean; error?: string; errors?: Record<number, string>;
        thanksText?: string; thanksUrl?: string; trialTokenHash?: string;
      };
      if (!json.ok) {
        if (json.errors) setErrs(json.errors);
        setFatal(json.error ?? "送信に失敗しました");
        setSending(false);
        return;
      }
      // 体験版：外部ロールで新規登録できた場合は、その場でログインしてポータルへ。
      //   メールを開く手間もパスワード設定も無い（＝離脱ポイントを潰す）。
      //   サンクスページURLが設定されている場合はそちらを優先する（運用側の明示指定を尊重）。
      if (json.trialTokenHash && !json.thanksUrl) {
        window.location.href = `/auth/trial?token_hash=${encodeURIComponent(json.trialTokenHash)}`;
        return;
      }
      if (json.thanksUrl) { window.location.href = json.thanksUrl; return; }
      setDone(json.thanksText || "ご回答ありがとうございました。");
    } catch {
      setFatal("送信に失敗しました。時間をおいて再度お試しください。");
      setSending(false);
    }
  };

  // ── 受付終了 ──
  if (!open) {
    return (
      <Shell form={form}>
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-600 whitespace-pre-wrap">
          {form.deadlineMessage || "現在このフォームは受け付けていません。"}
        </div>
      </Shell>
    );
  }

  // ── 完了 ──
  if (done) {
    return (
      <Shell form={form}>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-3xl mb-3">✓</div>
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-700">{done}</p>
        </div>
      </Shell>
    );
  }

  const pct = sections.length > 1 ? Math.round(((page + 1) / sections.length) * 100) : 100;

  return (
    <Shell form={form}>
      {form.design.progress && sections.length > 1 && (
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-4">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}

      {sections.length > 1 && (
        <p className="text-[11px] text-gray-400 mb-2 text-right">{page + 1} / {sections.length} ページ</p>
      )}

      <div className="space-y-3">
        {sec?.fields.map((f) => {
          if (!isVisible(f.condition, answers)) return null;
          return (
            <FieldInput
              key={f.id} f={f} value={answers[f.id]} err={errs[f.id]} color={color}
              onChange={(v) => set(f, v)} onCheck={(l) => toggleCheck(f, l)} onFile={(file) => pickFile(f, file)}
            />
          );
        })}

        {/* 外部の方の連絡先（最終ページのみ） */}
        {isLast && !me && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[13px] font-bold mb-1">ご連絡先</p>
            <p className="text-[11px] text-gray-500 mb-3">ご回答の確認・ご連絡に使用します。</p>
            <div className="space-y-2">
              <input className={inputCls} placeholder="お名前・ニックネーム" value={guest.name}
                onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
              <input className={inputCls} placeholder="メールアドレス" value={guest.email}
                onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            </div>
            {guestErr && <p className="text-[11.5px] text-red-600 mt-2">{guestErr}</p>}
          </div>
        )}
      </div>

      {fatal && <p className="text-[12.5px] text-red-600 mt-3">{fatal}</p>}

      <div className="flex gap-2 mt-5">
        {page > 0 && (
          <button onClick={prev} className="px-5 py-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-600">
            戻る
          </button>
        )}
        {!isLast ? (
          <button onClick={next} className="flex-1 py-3 rounded-xl text-white text-[15px] font-bold" style={{ background: color }}>
            次へ進む
          </button>
        ) : (
          <button onClick={submit} disabled={sending}
            className="flex-1 py-3 rounded-xl text-white text-[15px] font-bold disabled:opacity-60" style={{ background: color }}>
            {sending ? "送信中…" : (form.design.submitLabel || "送信する")}
          </button>
        )}
      </div>

      {me && (
        <p className="text-[11px] text-gray-400 mt-3 text-center">
          {me.name} さんとして回答します（会員情報に紐付きます）
        </p>
      )}
    </Shell>
  );
}

// ── 外枠（ヘッダー＋説明文）──────────────────────────────────
function Shell({ form, children }: { form: FormDef; children: React.ReactNode }) {
  const color = form.design.color || "#dc2626";
  return (
    <div className="min-h-screen py-0 sm:py-8" style={{ background: form.design.bgColor || "#f7f7f8" }}>
      {form.design.customCss && <style dangerouslySetInnerHTML={{ __html: form.design.customCss }} />}
      <div className="max-w-xl mx-auto">
        <div className="rounded-none sm:rounded-t-2xl overflow-hidden text-white px-5 py-6"
          style={{ background: `linear-gradient(135deg, ${color}, ${shade(color, -35)})` }}>
          {form.design.headerImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.design.headerImage} alt="" className="w-full rounded-lg mb-4" />
          )}
          <h1 className="text-lg font-extrabold leading-snug">{form.title || form.name}</h1>
          {form.description && (
            <p className="text-[12.5px] opacity-90 mt-2 leading-relaxed whitespace-pre-wrap">{form.description}</p>
          )}
        </div>
        <div className="px-4 py-5 sm:px-5">{children}</div>
        <p className="text-center text-[10.5px] text-gray-400 py-6">KAWAI CAMP</p>
      </div>
    </div>
  );
}

// 色を暗くする（ヘッダーのグラデーション用）
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const cl = (v: number) => Math.max(0, Math.min(255, v + amt));
  const r = cl((n >> 16) & 255), g = cl((n >> 8) & 255), b = cl(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ── 設問1つ ──────────────────────────────────────────────────
interface FIProps {
  f: FormField;
  value: string | string[] | undefined;
  err?: string;
  color: string;
  onChange: (v: string) => void;
  onCheck: (label: string) => void;
  onFile: (f: File | null) => void;
}

export function FieldInput({ f, value, err, color, onChange, onCheck, onFile }: FIProps) {
  const v = value;
  const list = Array.isArray(v) ? v : [];
  const s = Array.isArray(v) ? "" : String(v ?? "");

  if (f.type === "heading") {
    return (
      <div className="pt-3 pb-1">
        {f.label && <p className="text-[15px] font-extrabold text-gray-800">{f.label}</p>}
        {f.description && <p className="text-[12.5px] text-gray-500 mt-1 whitespace-pre-wrap leading-relaxed">{f.description}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[13.5px] font-bold text-gray-800 mb-1">
        {f.label}
        {f.required && <span className="text-red-600 text-[11px] ml-1.5">必須</span>}
      </p>
      {f.description && <p className="text-[11.5px] text-gray-500 mb-2 whitespace-pre-wrap">{f.description}</p>}

      {f.type === "text" && (
        <input className={inputCls} placeholder={f.placeholder} value={s} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.type === "number" && (
        <input className={inputCls} inputMode="numeric" placeholder={f.placeholder} value={s} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.type === "textarea" && (
        <textarea className={`${inputCls} min-h-[110px]`} placeholder={f.placeholder} value={s} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.type === "date" && (
        <input type="date" className={inputCls} value={s} onChange={(e) => onChange(e.target.value)} />
      )}
      {f.type === "select" && (
        <select className={inputCls} value={s} onChange={(e) => onChange(e.target.value)}>
          <option value="">選択してください</option>
          {f.options.map((o, i) => <option key={i} value={o.label}>{o.label}</option>)}
        </select>
      )}
      {f.type === "pref" && (
        <select className={inputCls} value={s} onChange={(e) => onChange(e.target.value)}>
          <option value="">選択してください</option>
          {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}
      {f.type === "radio" && (
        <div className="space-y-1">
          {f.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2.5 py-1.5 text-[14px] text-gray-700 cursor-pointer">
              <input type="radio" checked={s === o.label} onChange={() => onChange(o.label)}
                className="w-4 h-4" style={{ accentColor: color }} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      {f.type === "checkbox" && (
        <div className="space-y-1">
          {f.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2.5 py-1.5 text-[14px] text-gray-700 cursor-pointer">
              <input type="checkbox" checked={list.includes(o.label)} onChange={() => onCheck(o.label)}
                className="w-4 h-4" style={{ accentColor: color }} />
              {o.label}
            </label>
          ))}
          {f.maxSelect !== "" && <p className="text-[11px] text-gray-400 mt-1">最大{f.maxSelect}つまで選択できます</p>}
        </div>
      )}
      {f.type === "file" && (
        <div>
          <input type="file" onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[12.5px] file:font-bold file:bg-gray-100 file:text-gray-700" />
          <p className="text-[11px] text-gray-400 mt-1">5MBまで（画像・PDFなど）</p>
        </div>
      )}

      {err && <p className="text-[11.5px] text-red-600 mt-1.5">{err}</p>}
    </div>
  );
}
