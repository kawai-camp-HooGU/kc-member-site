"use client";
// ============================================================
// 公開回答画面（/f/[slug]）
//   セクション＝ページでページ送り。ログイン会員は自動で本人紐付け＋初期表示。
//   未ログイン（外部）は氏名・メールを入力して回答（後から会員に紐付け可）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { isVisibleGroup, validateField, formIsOpen, guestContactNeed } from "../../lib/formParse";
import type { AnswerMap } from "../../lib/formParse";
import { renderBodyHtml } from "../../lib/richText";
import { PublicFormHeader } from "./PublicFormHeader";
import { PREFECTURES } from "../../lib/members";
import type { FormDef, FormField } from "../../lib/models";
import { IS_DISPLAY_ONLY, DEFAULT_GUEST_CONTACT } from "../../lib/models";
import { Icon } from "../common/Icon";

interface Props { form: FormDef }

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[15px] focus:outline-none focus:border-gray-800 bg-white";

/**
 * 設問ラベルの帯（A-3 チャコール）。
 *   黒＝構造（どこからどこまでが1問か）／赤＝行動（送信ボタン）と役割を分ける。
 *   必須は赤い塗りではなく薄赤の文字にしている。設問が並ぶと赤い塗りが増殖して
 *   送信ボタンと同じ強さで主張してしまうため。
 */
export const BAND_REQUIRED = "bg-zinc-700";
export const BAND_OPTIONAL = "bg-zinc-100 border-b border-zinc-200";

export function PublicForm({ form }: Props) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [files, setFiles] = useState<Record<number, { name: string; dataUrl: string }>>({});
  const [errs, setErrs] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);
  const [me, setMe] = useState<{ id: number; name: string; email: string } | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [guestErr, setGuestErr] = useState("");
  const [sending, setSending] = useState(false);
  /** 完了画面。mode="html" なら html を、それ以外は text を表示する */
  const [done, setDone] = useState<{ mode: "text" | "html"; text: string; html: string } | null>(null);
  const [fatal, setFatal] = useState("");

  const color = form.design.color || "#dc2626";
  const open = formIsOpen(form);

  // ご連絡先欄の設定（未ログイン回答者向け）
  const gc = form.design.guestContact ?? DEFAULT_GUEST_CONTACT;
  /**
   * 「登録先＝氏名／メール」の設問で賄える分は、ご連絡先欄に出さない（重複入力の解消）。
   * 分岐で該当設問が消えたら自動的に欄が復活するので、メールが取れない事故は起きない。
   */
  const need = useMemo(() => guestContactNeed(form, answers), [form, answers]);
  // 会員登録アクションが1つでもあるか（あればメールは登録に必須）
  const wantsSignup = useMemo(() => {
    const opt = form.sections.flatMap((s) => s.fields.flatMap((f) => (f.options ?? []).flatMap((o) => o.actions ?? [])));
    return [...form.afterActions, ...opt].some((a) => a.type === "member_signup");
  }, [form]);

  // 表示するセクション（条件を満たすもの）
  const sections = useMemo(
    () => form.sections.filter((s) => isVisibleGroup(s.condition, answers)),
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

  // 分岐で非表示になった設問の回答をクリアする。
  //   残したままだと ①再表示したとき古い値が復活する
  //   ②その値を条件に使う後続の設問（連鎖分岐）が誤って表示・保存される。
  //   answers を消すと再評価が走るので、連鎖は数パスで自然に収束する
  //   （消すものが無くなった時点で止まる＝無限ループにはならない）。
  useEffect(() => {
    const hidden = new Set<number>();
    for (const sec of form.sections) {
      const secShown = isVisibleGroup(sec.condition, answers);
      for (const f of sec.fields) {
        if (IS_DISPLAY_ONLY(f.type)) continue;
        if (!secShown || !isVisibleGroup(f.condition, answers)) hidden.add(f.id);
      }
    }
    const toClear = [...hidden].filter((id) => answers[id] !== undefined);
    if (toClear.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const id of toClear) delete next[id];
      return next;
    });
    setFiles((prev) => {
      let changed = false; const next = { ...prev };
      for (const id of toClear) if (next[id]) { delete next[id]; changed = true; }
      return changed ? next : prev;
    });
    setErrs((prev) => {
      let changed = false; const next = { ...prev };
      for (const id of toClear) if (next[id]) { delete next[id]; changed = true; }
      return changed ? next : prev;
    });
  }, [answers, form.sections]);

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
      if (!isVisibleGroup(f.condition, answers)) continue;
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
      // 名前・メールの必須はフォーム設定に従う。ただし会員登録アクションがあると
      // メールは登録に不可欠なので、設定に関わらず必須にする。
      // 設問で賄っている項目は、その設問側で検証済みなのでここでは見ない。
      const nameBad = need.showName && gc.nameRequired && !guest.name.trim();
      const emailReq = gc.emailRequired || wantsSignup;
      const emailBad = !need.showEmail
        ? false
        : emailReq
          ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)
          : (guest.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email));
      if (nameBad || emailBad) {
        const lacking = [nameBad && gc.nameLabel, emailBad && gc.emailLabel].filter(Boolean).join("と");
        setGuestErr(`${lacking}を正しくご入力ください`);
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
          // 設問で賄った項目はその値を引き継ぐ（サーバーの pickName/pickEmail と二重の保険）
          guestName: need.showName ? guest.name : need.nameFromField,
          guestEmail: need.showEmail ? guest.email : need.emailFromField,
          // Phase 3：用語衝突の解消
          //   channel … どの導線でフォームに来たか（direct|chat|broadcast|scenario|qr）
          //   srcKey  … 流入経路（?src=）。sources.key と照合して members.source_id へ引き継ぐ
          channel: new URLSearchParams(window.location.search).get("ch") || "direct",
          srcKey:  new URLSearchParams(window.location.search).get("src"),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean; error?: string; errors?: Record<number, string>;
        thanksMode?: "text" | "html" | "url";
        thanksText?: string; thanksHtml?: string; thanksUrl?: string; trialTokenHash?: string;
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
      //   外部ロール（体験版）：まず /auth/trial で自動ログイン。
      //   サンクスURL（受取ページ等）が設定されていれば、ログイン後に next でそこへ着地させる。
      //   （thanksUrl があっても自動ログインを飛ばさない＝会員限定ページで弾かれないように）
      //   URLモードのときだけ遷移先として使う（テキスト／HTMLモードでは無視する）
      const gotoUrl = json.thanksMode === "url" ? (json.thanksUrl ?? "") : "";
      if (json.trialTokenHash) {
        const trialUrl =
          `/auth/trial?token_hash=${encodeURIComponent(json.trialTokenHash)}` +
          (gotoUrl ? `&next=${encodeURIComponent(gotoUrl)}` : "");
        window.location.href = trialUrl;
        return;
      }
      //   会員（ログイン済み）や外部トークンが無い場合：サンクスURLがあればそこへ遷移。
      if (gotoUrl) { window.location.href = gotoUrl; return; }
      setDone({
        mode: json.thanksMode === "html" ? "html" : "text",
        text: json.thanksText || "ご回答ありがとうございました。",
        html: json.thanksHtml ?? "",
      });
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
  //   HTMLモードは renderBodyHtml（許可タグ方式のサニタイズ）を通したものだけを描画する。
  if (done) {
    return (
      <Shell form={form}>
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-11 h-11 rounded-full bg-zinc-700 text-white grid place-items-center mx-auto mb-3 text-lg">✓</div>
          {done.mode === "html" ? (
            <div className="text-[15px] leading-relaxed text-gray-700 text-left rt-body"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml("html", "", done.html) }} />
          ) : (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-gray-700">{done.text}</p>
          )}
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
        {(() => {
          // B案：表示中の「見出し以外」の設問に、このページ内で連番を振る
          let n = 0;
          return sec?.fields.map((f) => {
            if (!isVisibleGroup(f.condition, answers)) return null;
            const no = IS_DISPLAY_ONLY(f.type) ? undefined : ++n;
            return (
              <FieldInput
                key={f.id} f={f} value={answers[f.id]} err={errs[f.id]} color={color} no={no}
                onChange={(v) => set(f, v)} onCheck={(l) => toggleCheck(f, l)} onFile={(file) => pickFile(f, file)}
              />
            );
          });
        })()}

        {/* 外部の方の連絡先（最終ページのみ）。見出し・説明・ラベル・必須はフォーム設定に従う。
            設問で賄えている項目は出さない。両方賄えていれば欄ごと出ない。 */}
        {isLast && !me && need.show && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className={`px-3.5 py-1.5 flex items-center gap-2 ${BAND_REQUIRED}`}>
              <span className="text-[11.5px] font-bold tracking-wide text-white">{gc.title}</span>
            </div>
            <div className="p-3.5">
              {gc.note && <p className="text-[11px] text-gray-500 mb-3">{gc.note}</p>}
              <div className="space-y-2">
                {need.showName && (
                  <input className={inputCls} placeholder={gc.nameLabel + (gc.nameRequired ? "（必須）" : "")}
                    value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                )}
                {need.showEmail && (
                  <input className={inputCls} placeholder={gc.emailLabel + ((gc.emailRequired || wantsSignup) ? "（必須）" : "")}
                    value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                )}
              </div>
              {guestErr && <p className="text-[11.5px] text-red-600 mt-2">{guestErr}</p>}
            </div>
          </div>
        )}

        {/* 設問の入力をそのまま会員登録に使う場合の確認カード（入力欄は出さない） */}
        {isLast && !me && !need.show && (need.nameFromField || need.emailFromField) && (
          <div className="bg-white rounded-xl border border-emerald-200 p-4">
            <p className="text-[11.5px] font-bold text-emerald-700 mb-2.5 flex items-center gap-1">
              <Icon name="check" size={13} stroke={3} /> この内容で送信します
            </p>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-zinc-700 text-white font-bold grid place-items-center shrink-0">
                {need.nameFromField ? need.nameFromField.slice(0, 1) : "?"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">{need.nameFromField || "（お名前未入力）"}</div>
                {need.emailFromField && (
                  <div className="text-[12px] text-gray-500 font-mono truncate">{need.emailFromField}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 会員本人の確認カード（ログイン会員の最終ページ・送信ボタンの手前）。
          入力欄ではなく表示だけ。誤って別アカウントで送るのを防ぐ。 */}
      {me && isLast && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mt-3">
          <p className="text-[11.5px] font-bold text-emerald-600 mb-2.5 flex items-center gap-1">
            <Icon name="check" size={13} stroke={3} /> このアカウントとして回答します
          </p>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-red-100 text-red-700 font-bold grid place-items-center shrink-0">
              {me.name ? me.name.slice(0, 1) : "?"}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-gray-800 truncate">{me.name}</div>
              {me.email && <div className="text-[12px] text-gray-500 font-mono truncate">{me.email}</div>}
            </div>
          </div>
        </div>
      )}

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
    </Shell>
  );
}

// ── 外枠（ブランドヘッダー＋カード枠）────────────────────────
//   最上部に画面幅いっぱいの黒いブランドヘッダー（ロゴ中央揃え）を置き、
//   余白を挟んでから、フォーム本体を1枚のカード枠で囲う。
//   カードの中は従来どおり「色帯（タイトル）＋本文」が地続きに見えるようにする。
//   ⚠️ 黒帯とカードの間の余白（py-5 sm:py-8）は詰めないこと。ここが無いと
//      ブランドヘッダーとフォームのタイトル帯が2段の帯に見えて主従が崩れる。
function Shell({ form, children }: { form: FormDef; children: React.ReactNode }) {
  const color = form.design.color || "#dc2626";
  return (
    <div className="min-h-screen" style={{ background: form.design.bgColor || "#f7f7f8" }}>
      {form.design.customCss && <style dangerouslySetInnerHTML={{ __html: form.design.customCss }} />}
      <PublicFormHeader />
      <div className="max-w-xl mx-auto sm:px-4 py-5 sm:py-8">
        {/* フォーム全体を囲うカード枠（ヘッダー＋本文を1枚に） */}
        <div className="sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-sm overflow-hidden">
          <div className="overflow-hidden text-white px-5 py-6"
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
          {/* 本文エリアは薄い背景。中の白いカード（設問・連絡先）が浮いて見える */}
          <div className="px-4 py-5 sm:px-6" style={{ background: form.design.bgColor || "#f7f7f8" }}>{children}</div>
        </div>
        {/* 下の余白は外側のコンテナ（py-5 sm:py-8）が持つので、ここは上だけ空ける */}
        <p className="text-center text-[10.5px] text-gray-400 pt-6">KAWAI CAMP</p>
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
  /** 設問番号（B案）。見出しなど番号を振らない設問は未指定 */
  no?: number;
  onChange: (v: string) => void;
  onCheck: (label: string) => void;
  onFile: (f: File | null) => void;
}

/**
 * 設問の説明文。descHtml=true ならサニタイズHTML（renderBodyHtml）、
 * それ以外はプレーンテキスト（改行を whitespace-pre-wrap で保持）。
 * ⚠️ 生HTMLは絶対に出さない。必ず renderBodyHtml を通す。
 */
function Desc({ f, className }: { f: FormField; className: string }) {
  if (!f.description) return null;
  if (f.descHtml) {
    return (
      <div className={`${className} rt-body`}
        dangerouslySetInnerHTML={{ __html: renderBodyHtml("html", "", f.description) }} />
    );
  }
  return <p className={`${className} whitespace-pre-wrap`}>{f.description}</p>;
}

/**
 * 選択肢の価格カード（C案）。ラベルの「｜」または「|」で名称と価格・補足を分けて表示する。
 *   選択中はブランド色の枠＋チェック。タップ範囲を大きく取り、スマホでの選び間違いを防ぐ。
 *   multi=true はチェックボックス用（複数選択・角は同じ）。
 */
function OptionCard({
  label, checked, color, multi, onClick,
}: { label: string; checked: boolean; color: string; multi?: boolean; onClick: () => void }) {
  const [name, sub] = (() => {
    const m = label.split(/｜|\|/);
    return m.length > 1 ? [m[0].trim(), m.slice(1).join("|").trim()] : [label, ""];
  })();
  return (
    <button type="button" onClick={onClick} aria-pressed={checked}
      className="w-full text-left rounded-2xl border-2 px-3.5 py-3 flex items-center gap-3 transition-colors"
      style={{
        borderColor: checked ? color : "#e5e7eb",
        background: checked ? `${color}0d` : "#fff",   // 0d = 約5%の薄い塗り
      }}>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-extrabold text-gray-900 truncate">{name}</p>
        {sub && <p className="text-[13px] font-extrabold mt-0.5" style={{ color: checked ? color : "#6b7280" }}>{sub}</p>}
      </div>
      <span className={`shrink-0 grid place-items-center text-white text-[12px] ${multi ? "rounded-md" : "rounded-full"}`}
        style={{ width: 22, height: 22, background: checked ? color : "#d1d5db" }}>
        {checked ? "✓" : ""}
      </span>
    </button>
  );
}

export function FieldInput({ f, value, err, color, no, onChange, onCheck, onFile }: FIProps) {
  const v = value;
  const list = Array.isArray(v) ? v : [];
  const s = Array.isArray(v) ? "" : String(v ?? "");
  // 選択肢をカードで見せるのはラジオ・チェックのときだけ（select はプルダウンのまま）
  const asCards = f.optionCards && (f.type === "radio" || f.type === "checkbox");

  if (f.type === "heading") {
    return (
      <div className="pt-3 pb-1">
        {f.label && <p className="text-[15px] font-extrabold text-gray-800">{f.label}</p>}
        <Desc f={f} className="text-[12.5px] text-gray-500 mt-1 leading-relaxed" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 項目名の帯。必須＝チャコール／任意＝薄灰。1問の境界をこの帯が担う。
          B案：左端に設問番号バッジを出して「今どの設問か」を分かりやすくする。 */}
      <div className={`px-3 py-1.5 flex items-center gap-2 ${f.required ? BAND_REQUIRED : BAND_OPTIONAL}`}>
        {no != null && (
          <span className={`w-4 h-4 rounded text-[9px] font-extrabold grid place-items-center shrink-0 ${
            f.required ? "bg-white/20 text-white" : "bg-zinc-300 text-zinc-600"}`}>{no}</span>
        )}
        <span className={`text-[11.5px] font-bold tracking-wide ${f.required ? "text-white" : "text-zinc-600"}`}>
          {f.label}
        </span>
        <span className="flex-1" />
        <span className={`text-[9.5px] font-extrabold tracking-wide ${f.required ? "text-red-300" : "text-zinc-400"}`}>
          {f.required ? "必須" : "任意"}
        </span>
      </div>

      <div className="p-3.5">
      <Desc f={f} className="text-[11.5px] text-gray-500 mb-2" />

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
      {f.type === "radio" && (asCards ? (
        <div className="space-y-2">
          {f.options.map((o, i) => (
            <OptionCard key={i} label={o.label} checked={s === o.label} color={color}
              onClick={() => onChange(o.label)} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {f.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2.5 py-1.5 text-[14px] text-gray-700 cursor-pointer">
              {/* 選択中の印はチャコール。赤は送信ボタンだけに残す（A-3） */}
              <input type="radio" checked={s === o.label} onChange={() => onChange(o.label)}
                className="w-4 h-4" style={{ accentColor: "#3f3f46" }} />
              {o.label}
            </label>
          ))}
        </div>
      ))}
      {f.type === "checkbox" && (asCards ? (
        <div className="space-y-2">
          {f.options.map((o, i) => (
            <OptionCard key={i} label={o.label} checked={list.includes(o.label)} color={color} multi
              onClick={() => onCheck(o.label)} />
          ))}
          {f.maxSelect !== "" && <p className="text-[11px] text-gray-400 mt-1.5">最大{f.maxSelect}つまで選択できます</p>}
        </div>
      ) : (
        <div className="space-y-1">
          {f.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2.5 py-1.5 text-[14px] text-gray-700 cursor-pointer">
              <input type="checkbox" checked={list.includes(o.label)} onChange={() => onCheck(o.label)}
                className="w-4 h-4" style={{ accentColor: "#3f3f46" }} />
              {o.label}
            </label>
          ))}
          {f.maxSelect !== "" && <p className="text-[11px] text-gray-400 mt-1">最大{f.maxSelect}つまで選択できます</p>}
        </div>
      ))}
      {f.type === "file" && (
        <div>
          <input type="file" onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12.5px] text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[12.5px] file:font-bold file:bg-gray-100 file:text-gray-700" />
          <p className="text-[11px] text-gray-400 mt-1">5MBまで（画像・PDFなど）</p>
        </div>
      )}

      {err && <p className="text-[11.5px] text-red-600 mt-1.5">{err}</p>}
      </div>
    </div>
  );
}
